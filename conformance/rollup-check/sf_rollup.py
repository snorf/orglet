#!/usr/bin/env python3
"""
rollup-check, simple-salesforce leg: creates an Account, a Project__c and two Milestone__c in a
running orglet, then checks the roll-up describe flags, live recompute on insert, a SOQL filter
and sort over a roll-up column, the rejection of a direct write and the recompute on delete
through simple-salesforce. One PASS/FAIL line per check; exit 1 on any FAIL. The records are
deleted again at the end.

With FIXTURE=enterprise it adds formula-rollup: a roll-up over a formula field
(Service_Order__c.Total_Lines__c over Service_Order_Line__c.Line_Total__c) recomputed on insert
and update, so the expected total is 6 instead of 5.

Usage: BASE_URL=http://localhost:8083 [FIXTURE=enterprise] python sf_rollup.py
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

    tag = f"rollup-check-{int(time.time() * 1000)}"
    results = []
    acct = None
    order = None

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
        acct = sf.Account.create({"Name": f"RollupCheck {tag}"})["id"]
        project = getattr(sf, "Project__c")
        milestone = getattr(sf, "Milestone__c")
        proj = project.create({"Name": f"RC Project {tag}", "Account__c": acct, "Budget__c": 120, "Status__c": "Active"})["id"]
        open_ms = milestone.create({"Project__c": proj, "Due_Date__c": "2026-06-01"})["id"]
        milestone.create({"Project__c": proj, "Due_Date__c": "2026-07-01", "Done__c": True})

        def proj_counts():
            return sf.query(f"SELECT Milestone_Count__c, Open_Milestones__c FROM Project__c WHERE Id = '{proj}'")["records"][0]

        def describe_flags():
            def flags(f):
                return {"calculated": f.get("calculated"), "createable": f.get("createable"), "updateable": f.get("updateable")}
            want = {"calculated": True, "createable": False, "updateable": False}
            p = next(f for f in project.describe()["fields"] if f["name"] == "Milestone_Count__c")
            a = next(f for f in sf.Account.describe()["fields"] if f["name"] == "Total_Budget__c")
            return flags(p) == want and flags(a) == want, {"Milestone_Count__c": flags(p), "Total_Budget__c": flags(a)}

        def recompute_insert():
            p = proj_counts()
            a = sf.query(f"SELECT Total_Budget__c FROM Account WHERE Id = '{acct}'")["records"][0]
            ok = p["Milestone_Count__c"] == 2 and p["Open_Milestones__c"] == 1 and a["Total_Budget__c"] == 120
            return ok, {"Milestone_Count__c": p["Milestone_Count__c"], "Open_Milestones__c": p["Open_Milestones__c"], "Total_Budget__c": a["Total_Budget__c"]}

        def soql_filter_sort():
            r = sf.query(f"SELECT Id, Milestone_Count__c FROM Project__c WHERE Milestone_Count__c > 1 AND Name LIKE '%{tag}' ORDER BY Milestone_Count__c DESC")["records"]
            ids = [x["Id"] for x in r]
            return ids == [proj], {"ids": ids, "expected": [proj]}

        def write_rejected():
            code = None
            try:
                project.update(proj, {"Milestone_Count__c": 99})
            except SalesforceError as exc:
                content = exc.content[0] if isinstance(exc.content, list) and exc.content else {}
                code = content.get("errorCode")
            after = proj_counts()["Milestone_Count__c"]
            return code == "INVALID_FIELD_FOR_INSERT_UPDATE" and after == 2, {"errorCode": code, "Milestone_Count__c": after}

        def recompute_delete():
            milestone.delete(open_ms)
            p = proj_counts()
            return p["Milestone_Count__c"] == 1 and p["Open_Milestones__c"] == 0, {"Milestone_Count__c": p["Milestone_Count__c"], "Open_Milestones__c": p["Open_Milestones__c"]}

        def formula_rollup():
            nonlocal order
            order_obj = getattr(sf, "Service_Order__c")
            line_obj = getattr(sf, "Service_Order_Line__c")
            order = order_obj.create({"Name": f"RC Order {tag}"})["id"]
            line_obj.create({"Service_Order__c": order, "Quantity__c": 2, "Unit_Price__c": 10})
            second = line_obj.create({"Service_Order__c": order, "Quantity__c": 3, "Unit_Price__c": 5})["id"]

            def read():
                r = sf.query(f"SELECT Total_Lines__c, Line_Count__c FROM Service_Order__c WHERE Id = '{order}'")["records"][0]
                return {"Total_Lines__c": r["Total_Lines__c"], "Line_Count__c": r["Line_Count__c"]}
            a = read()
            line_obj.update(second, {"Quantity__c": 1})
            b = read()
            ok = a["Total_Lines__c"] == 35 and a["Line_Count__c"] == 2 and b["Total_Lines__c"] == 25 and b["Line_Count__c"] == 2
            return ok, {"afterInsert": a, "afterUpdate": b}

        check("describe-flags", describe_flags)
        check("recompute-insert", recompute_insert)
        check("soql-filter-sort", soql_filter_sort)
        check("write-rejected", write_rejected)
        check("recompute-delete", recompute_delete)
        if ENTERPRISE:
            check("formula-rollup", formula_rollup)
    except Exception as exc:  # noqa: BLE001
        results.append(False)
        print(f"FAIL setup {type(exc).__name__}: {exc}")
    finally:
        if acct:
            try:
                sf.Account.delete(acct)
            except Exception:  # noqa: BLE001
                pass
        if order:
            try:
                sf.Service_Order__c.delete(order)
            except Exception:  # noqa: BLE001
                pass

    passed = sum(1 for r in results if r)
    print(f"simple-salesforce: {passed}/{EXPECTED} passed")
    sys.exit(0 if passed == EXPECTED and len(results) == EXPECTED else 1)


if __name__ == "__main__":
    main()
