#!/usr/bin/env python3
"""
Conformance check of orglet (a Salesforce-compatible emulator) against the
simple-salesforce Python SDK.

The orglet server must already be listening at BASE_URL with permissive auth
(any password for USERNAME). This script never stops at the first failure:
every check runs in isolation, exceptions are caught, and a PASS/FAIL line is
printed for each one, followed by a final summary table.
"""
import sys
import traceback
from contextlib import contextmanager

import requests
from simple_salesforce import Salesforce, SalesforceLogin
from simple_salesforce.exceptions import (
    SalesforceExpiredSession,
    SalesforceMalformedRequest,
    SalesforceResourceNotFound,
)

BASE_URL = "http://localhost:8180"
USERNAME = "admin@orglet.local"
API_VERSION = "59.0"

results = []  # (name, "PASS"/"FAIL", detail)


@contextmanager
def check(name):
    """Run a block; record PASS if it completes without raising, else FAIL.
    Never re-raises, so the caller always proceeds to the next check."""
    try:
        yield
    except Exception as exc:  # noqa: BLE001 - intentionally broad: this is a test harness
        results.append((name, "FAIL", f"{type(exc).__name__}: {exc}"))
        print(f"[FAIL] {name}")
        print(f"       {type(exc).__name__}: {exc}")
        traceback.print_exc(file=sys.stdout, limit=3)
    else:
        results.append((name, "PASS", ""))
        print(f"[PASS] {name}")


class HttpRewriteSession(requests.Session):
    """simple_salesforce always builds https://{sf_instance}/... URLs (in
    base_url, SFType.base_url, and query_more's identifier_is_url branch),
    even when instance_url was given as http://. Our local server is plain
    HTTP, so rewrite the scheme back to http before the request goes out."""

    def request(self, method, url, *args, **kwargs):
        if url.startswith("https://"):
            url = "http://" + url[len("https://"):]
        return super().request(method, url, *args, **kwargs)


def main():
    session = HttpRewriteSession()

    print("=== Login ===")
    session_id, instance = SalesforceLogin(
        username=USERNAME,
        password="x",
        sf_version=API_VERSION,
        scratch_url=BASE_URL,  # login.py appends /services/Soap/u/{version} itself
        session=session,
    )
    print(f"session established, instance={instance}")

    sf = Salesforce(session_id=session_id, instance_url=BASE_URL, version=API_VERSION, session=session)

    def composite_create(type_name, records):
        """Create records via composite/sobjects. Used only to arrange fixtures
        for checks below that don't themselves test SFType.create() -- see the
        note on 2a/2b: SFType.create()/metadata() POST/GET to a URL with a
        trailing slash, which orglet's router 404s on, so relying on
        sf.<Type>.create() to set up later fixtures would cascade-fail
        unrelated checks. composite/sobjects has no trailing slash and is
        independently verified working in 9a."""
        payload = {"allOrNone": True, "records": [{"attributes": {"type": type_name}, **r} for r in records]}
        res = sf.restful("composite/sobjects", method="POST", json=payload)
        for r in res:
            assert r["success"], res
        return [r["id"] for r in res]

    # ---- 1. describe / metadata ----------------------------------------------------
    with check("1a sf.describe() contains Account"):
        g = sf.describe()
        names = [o["name"] for o in g["sobjects"]]
        assert "Account" in names, f"Account not in {len(names)} sobjects"

    with check("1b sf.Account.describe() has Name field"):
        d = sf.Account.describe()
        fields = [f["name"] for f in d["fields"]]
        assert "Name" in fields, fields

    with check("1c sf.Account.metadata()"):
        m = sf.Account.metadata()
        assert "objectDescribe" in m, m

    # ---- 2. create Account + Contact -------------------------------------------------
    # These two checks are graded literally as specified. Note: SFType.create() POSTs to
    # self.base_url, which simple_salesforce builds WITH a trailing slash
    # (".../sobjects/Account/"); orglet's Fastify router only registers the no-slash path
    # and 404s on this, so both are expected to FAIL -- see the report for detail. Fixture
    # data for later checks is arranged via composite_create() instead, so this bug does
    # not cascade into unrelated checks below.
    with check("2a create Account -> id starts with 001"):
        res = sf.Account.create({"Name": "Acme Energy Co", "Industry": "Energy", "Website": "https://acme.example.com"})
        assert res["success"] is True, res
        assert res["id"].startswith("001"), res["id"]

    with check("2b create Contact -> id starts with 003"):
        res = sf.Contact.create({"FirstName": "Wile", "LastName": "Coyote"})
        assert res["success"] is True, res
        assert res["id"].startswith("003"), res["id"]

    # Fixtures for checks 3-5, arranged via composite_create (unaffected by the 2a/2b bug).
    account_id = None
    contact_id = None
    try:
        account_id = composite_create("Account", [{"Name": "Acme Energy Co", "Industry": "Energy", "Website": "https://acme.example.com"}])[0]
        contact_id = composite_create("Contact", [{"AccountId": account_id, "FirstName": "Wile", "LastName": "Coyote"}])[0]
    except Exception as exc:  # noqa: BLE001
        print(f"[SETUP FAILED] could not arrange fixtures for checks 3-5: {exc}")

    # ---- 3. get / upsert / get_by_custom_id ------------------------------------------
    with check("3a Account.get(id) returns Name"):
        assert account_id
        rec = sf.Account.get(account_id)
        assert rec["Name"] == "Acme Energy Co", rec.get("Name")

    with check("3b upsert create (Customer_Number__c/C-9) -> 201"):
        status = sf.Account.upsert("Customer_Number__c/C-9", {"Name": "Up"})
        assert status == 201, status

    with check("3c upsert update (Customer_Number__c/C-9) -> 204"):
        status = sf.Account.upsert("Customer_Number__c/C-9", {"Name": "Up"})
        assert status == 204, status

    with check("3d get_by_custom_id(Customer_Number__c, C-9)"):
        rec = sf.Account.get_by_custom_id("Customer_Number__c", "C-9")
        assert rec["Name"] == "Up", rec.get("Name")

    # ---- 4. update ---------------------------------------------------------------
    with check("4a Account.update -> 204"):
        assert account_id
        status = sf.Account.update(account_id, {"Name": "Renamed"})
        assert status == 204, status

    with check("4b get shows Renamed"):
        rec = sf.Account.get(account_id)
        assert rec["Name"] == "Renamed", rec.get("Name")

    # ---- 5. query / query_all / query_more ----------------------------------------
    with check("5a nested subquery Account -> (SELECT LastName FROM Contacts)"):
        assert account_id
        q = f"SELECT Id, Name, (SELECT LastName FROM Contacts) FROM Account WHERE Id = '{account_id}'"
        res = sf.query(q)
        assert res["totalSize"] == 1, res
        contacts = res["records"][0]["Contacts"]["records"]
        assert any(c["LastName"] == "Coyote" for c in contacts), contacts

    with check("5b parent lookup Contact -> Account.Name"):
        assert contact_id
        q = f"SELECT Id, Account.Name FROM Contact WHERE Id = '{contact_id}'"
        res = sf.query(q)
        rec = res["records"][0]
        assert rec["Account"]["Name"] == "Renamed", rec.get("Account")

    with check("5c query_all basic"):
        res = sf.query_all("SELECT Id FROM Account")
        assert res["done"] is True, res
        assert res["totalSize"] >= 1, res

    with check("5d query_more via nextRecordsUrl (forced batchSize=200)"):
        prefix = "PageTest-"
        total = 210
        # Seeded via composite_create (chunked at 200, matching the real Collections API
        # limit) rather than a loop of sf.Account.create(), which hits the 2a/2b bug.
        pending = [{"Name": f"{prefix}{i:04d}"} for i in range(total)]
        while pending:
            composite_create("Account", pending[:200])
            pending = pending[200:]
        res = sf.query(
            f"SELECT Id FROM Account WHERE Name LIKE '{prefix}%'",
            headers={"Sforce-Query-Options": "batchSize=200"},
        )
        assert res["done"] is False, "expected pagination with 210 rows and batchSize=200"
        assert "nextRecordsUrl" in res, res
        assert len(res["records"]) == 200, len(res["records"])
        more = sf.query_more(res["nextRecordsUrl"], identifier_is_url=True)
        assert more["done"] is True, more
        assert len(more["records"]) == total - 200, len(more["records"])

    # ---- 6. validation rule --------------------------------------------------------
    with check("6 validation rule -> FIELD_CUSTOM_VALIDATION_EXCEPTION"):
        try:
            sf.Account.create({"Name": "NoWebsite Corp", "Type": "Customer - Direct"})
            raise AssertionError("expected SalesforceMalformedRequest")
        except SalesforceMalformedRequest as e:
            errs = e.content
            assert isinstance(errs, list) and errs, errs
            assert errs[0]["errorCode"] == "FIELD_CUSTOM_VALIDATION_EXCEPTION", errs
            assert errs[0]["message"] == "Website is required for direct customers.", errs

    # ---- 7. delete -----------------------------------------------------------------
    # Fixture arranged via composite_create (sf.Account.delete() itself uses urljoin,
    # like update()/upsert() above, and is unaffected by the 2a/2b trailing-slash bug).
    delete_id = None
    with check("7a Account.delete -> 204"):
        delete_id = composite_create("Account", [{"Name": "ToDelete Inc"}])[0]
        status = sf.Account.delete(delete_id)
        assert status == 204, status

    with check("7b get after delete -> SalesforceResourceNotFound"):
        assert delete_id
        try:
            sf.Account.get(delete_id)
            raise AssertionError("expected SalesforceResourceNotFound")
        except SalesforceResourceNotFound:
            pass

    with check("7c query_all(include_deleted=True) shows IsDeleted true"):
        assert delete_id
        res = sf.query_all(f"SELECT Id, IsDeleted FROM Account WHERE Id = '{delete_id}'", include_deleted=True)
        assert res["totalSize"] == 1, res
        assert res["records"][0]["IsDeleted"] is True, res["records"][0]

    # ---- 8. limits / search ---------------------------------------------------------
    with check("8a sf.limits()"):
        lim = sf.limits()
        assert "DailyApiRequests" in lim, lim

    with check("8b sf.search('FIND {Acme}') returns dict with searchRecords"):
        res = sf.search("FIND {Acme}")
        assert isinstance(res, dict) and "searchRecords" in res, res

    # ---- 9. composite ----------------------------------------------------------------
    with check("9a composite/sobjects creates 2 accounts"):
        payload = {
            "allOrNone": True,
            "records": [
                {"attributes": {"type": "Account"}, "Name": "Composite A"},
                {"attributes": {"type": "Account"}, "Name": "Composite B"},
            ],
        }
        res = sf.restful("composite/sobjects", method="POST", json=payload)
        assert isinstance(res, list) and len(res) == 2, res
        assert all(r["success"] for r in res), res
        assert all(r["id"].startswith("001") for r in res), res

    with check("9b composite with two subrequests + @{ref} substitution"):
        payload = {
            "compositeRequest": [
                {
                    "method": "POST",
                    "url": f"/services/data/v{API_VERSION}/sobjects/Account",
                    "referenceId": "ref1",
                    "body": {"Name": "Composite Sub A"},
                },
                {
                    "method": "GET",
                    "url": f"/services/data/v{API_VERSION}/sobjects/Account/@{{ref1.id}}",
                    "referenceId": "ref2",
                },
            ]
        }
        res = sf.restful("composite", method="POST", json=payload)
        responses = res["compositeResponse"]
        assert len(responses) == 2, responses
        assert responses[0]["httpStatusCode"] == 201, responses[0]
        assert responses[1]["httpStatusCode"] == 200, responses[1]
        assert responses[1]["body"]["Name"] == "Composite Sub A", responses[1]["body"]

    # ---- 10. error shapes -------------------------------------------------------------
    with check("10a Account.create({}) -> REQUIRED_FIELD_MISSING"):
        try:
            sf.Account.create({})
            raise AssertionError("expected SalesforceMalformedRequest")
        except SalesforceMalformedRequest as e:
            assert isinstance(e.content, list) and e.content, e.content
            assert e.content[0]["errorCode"] == "REQUIRED_FIELD_MISSING", e.content

    with check("10b query bad field -> INVALID_FIELD"):
        try:
            sf.query("SELECT Nope FROM Account")
            raise AssertionError("expected SalesforceMalformedRequest")
        except SalesforceMalformedRequest as e:
            assert isinstance(e.content, list) and e.content, e.content
            assert e.content[0]["errorCode"] == "INVALID_FIELD", e.content

    with check("10c bogus session id -> SalesforceExpiredSession"):
        bogus_session = HttpRewriteSession()
        bogus = Salesforce(session_id="bogus-session-id-12345", instance_url=BASE_URL, version=API_VERSION, session=bogus_session)
        try:
            bogus.Account.describe()
            raise AssertionError("expected SalesforceExpiredSession")
        except SalesforceExpiredSession:
            pass

    # ---- summary -----------------------------------------------------------------
    print("\n=== Summary ===")
    width = max(len(n) for n, _, _ in results)
    passed = sum(1 for _, s, _ in results if s == "PASS")
    for name, status, detail in results:
        line = f"{name.ljust(width)}  {status}"
        if status == "FAIL" and detail:
            line += f"  ({detail})"
        print(line)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
