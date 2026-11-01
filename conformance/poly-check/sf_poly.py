#!/usr/bin/env python3
"""
poly-check, simple-salesforce leg: creates a Queue (Group), a Group-owned Case and a User-owned
Case in a running orglet, then checks a Name-object query, an Owner.Type filter, a TYPEOF query
and the rejection of an invalid TYPEOF through simple-salesforce. One PASS/FAIL line per check;
exit 1 on any FAIL. The records are deleted again at the end.

Also checks OwnerId narrowing (Account [User], Case [Group, User]) on every fixture. With
FIXTURE=enterprise it adds owner-colon-formula (Owner:User.Email / Owner:Queue.Name formulas on
Case), so the expected total is 6 instead of 5.

Usage: BASE_URL=http://localhost:8082 [FIXTURE=enterprise] python sf_poly.py
Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
     ORGLET_PASSWORD (x), API_VERSION (59.0).
"""
import json
import os
import sys
import time

import requests
from simple_salesforce import Salesforce, SalesforceLogin
from simple_salesforce.exceptions import SalesforceError

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8081")
USERNAME = os.environ.get("ORGLET_USERNAME", "admin@orglet.local")
PASSWORD = os.environ.get("ORGLET_PASSWORD", "x")
API_VERSION = os.environ.get("API_VERSION", "59.0")
ENTERPRISE = os.environ.get("FIXTURE", "acme") == "enterprise"
EXPECTED = 6 if ENTERPRISE else 5


class HttpRewriteSession(requests.Session):
    """Copied from conformance/python/run.py: simple_salesforce always builds https:// URLs,
    while a local orglet speaks plain HTTP."""

    def request(self, method, url, *args, **kwargs):
        if url.startswith("https://"):
            url = "http://" + url[len("https://"):]
        return super().request(method, url, *args, **kwargs)


def main():
    session = HttpRewriteSession()
    session_id, _instance = SalesforceLogin(username=USERNAME, password=PASSWORD, sf_version=API_VERSION, scratch_url=BASE_URL, session=session)
    sf = Salesforce(session_id=session_id, instance_url=BASE_URL, version=API_VERSION, session=session)

    millis = int(time.time() * 1000)
    tag = f"poly-check-{millis}"
    group_name = f"PolyCheck Queue {tag}"
    results = []
    created_cases = []
    created_group = None

    def check(name, fn):
        try:
            ok, detail = fn()
        except Exception as exc:  # noqa: BLE001 - a harness reports every failure and moves on
            results.append(False)
            print(f"FAIL {name} {type(exc).__name__}: {exc}")
            return
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'} {name} {detail if isinstance(detail, str) else json.dumps(detail, separators=(',', ':'))}")

    try:
        created_group = sf.Group.create({"Name": group_name, "DeveloperName": f"PolyCheck_{millis}", "Type": "Queue"})["id"]
        group_case = sf.Case.create({"Subject": f"group {tag}", "OwnerId": created_group})["id"]
        created_cases.append(group_case)
        user_case = sf.Case.create({"Subject": f"user {tag}"})["id"]
        created_cases.append(user_case)

        def name_object():
            r = sf.query(f"SELECT Subject, Owner.Name, Owner.Email, Owner.Type FROM Case WHERE Subject LIKE '%{tag}' ORDER BY Subject")["records"]
            grp, usr = r[0]["Owner"], r[1]["Owner"]
            ok = (len(r) == 2
                  and grp["attributes"]["type"] == "Group" and grp["Name"] == group_name and grp["Email"] is None and grp["Type"] == "Group"
                  and usr["attributes"]["type"] == "User" and usr["Type"] == "User")
            return ok, {"group": grp, "user": usr}

        def type_filter():
            r = sf.query(f"SELECT Id FROM Case WHERE Owner.Type = 'Group' AND Subject LIKE '%{tag}'")["records"]
            ids = [x["Id"] for x in r]
            return ids == [group_case], {"ids": ids, "expected": [group_case]}

        def typeof():
            r = sf.query(f"SELECT Subject, TYPEOF Owner WHEN User THEN Alias WHEN Group THEN Name, Type END FROM Case WHERE Subject LIKE '%{tag}' ORDER BY Subject")["records"]
            grp, usr = r[0]["Owner"], r[1]["Owner"]
            ok = (len(r) == 2 and list(grp.keys()) == ["attributes", "Name", "Type"] and grp["Type"] == "Queue"
                  and list(usr.keys()) == ["attributes", "Alias"])
            return ok, {"group": list(grp.keys()), "groupType": grp.get("Type"), "user": list(usr.keys())}

        def typeof_invalid():
            try:
                sf.query("SELECT COUNT(), TYPEOF Owner WHEN User THEN Name END FROM Case")
            except SalesforceError as exc:
                content = exc.content[0] if isinstance(exc.content, list) and exc.content else {}
                ok = content.get("errorCode") == "MALFORMED_QUERY" and "such as COUNT()" in content.get("message", "")
                return ok, {"errorCode": content.get("errorCode"), "message": content.get("message")}
            return False, "query was accepted"

        def owner_narrowed():
            def refs(sobject):
                fields = getattr(sf, sobject).describe()["fields"]
                return next(f for f in fields if f["name"] == "OwnerId")["referenceTo"]
            acct, kase = refs("Account"), sorted(refs("Case"))
            return acct == ["User"] and kase == ["Group", "User"], {"account": acct, "case": kase}

        def owner_colon_formula():
            admin = sf.query(f"SELECT Email FROM User WHERE Username = '{USERNAME}'")["records"][0]["Email"]
            r = sf.query(f"SELECT Id, Owner_User_Email__c, Owner_Queue_Name__c FROM Case WHERE Id IN ('{group_case}', '{user_case}')")["records"]
            by_id = {x["Id"]: x for x in r}
            grp, usr = by_id.get(group_case), by_id.get(user_case)
            blank = lambda v: v is None or v == ""  # noqa: E731
            ok = (len(r) == 2 and bool(admin)
                  and usr["Owner_User_Email__c"] == admin and blank(usr["Owner_Queue_Name__c"])
                  and grp["Owner_Queue_Name__c"] == group_name and blank(grp["Owner_User_Email__c"]))
            return ok, {"admin": admin, "user": usr, "queue": grp}

        check("name-object", name_object)
        check("type-filter", type_filter)
        check("typeof", typeof)
        check("owner-narrowed", owner_narrowed)
        if ENTERPRISE:
            check("owner-colon-formula", owner_colon_formula)
        check("typeof-invalid", typeof_invalid)
    except Exception as exc:  # noqa: BLE001
        results.append(False)
        print(f"FAIL setup {type(exc).__name__}: {exc}")
    finally:
        for cid in created_cases:
            try:
                sf.Case.delete(cid)
            except Exception:  # noqa: BLE001
                pass
        if created_group:
            try:
                sf.Group.delete(created_group)
            except Exception:  # noqa: BLE001
                pass

    passed = sum(1 for r in results if r)
    print(f"simple-salesforce: {passed}/{EXPECTED} passed")
    sys.exit(0 if passed == EXPECTED and len(results) == EXPECTED else 1)


if __name__ == "__main__":
    main()
