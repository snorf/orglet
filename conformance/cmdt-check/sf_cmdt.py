#!/usr/bin/env python3
"""
cmdt-check, simple-salesforce leg: describe, query, retrieve and relationship traversal on the custom
metadata types of the fixture in ./project, the rejection of DML on a __mdt, and the custom-setting
describe and hierarchy uniqueness. Checks: describe-mdt, query-values, retrieve, relationships,
entity-definition-only, dml-rejected, setting-describe, hierarchy-duplicate. One PASS/FAIL line per
check; exit 1 on any FAIL. App_Config__c rows it creates are deleted again at the end.

Usage: BASE_URL=http://localhost:8095 python sf_cmdt.py
Env: BASE_URL (default http://localhost:8095), ORGLET_USERNAME (admin@orglet.local),
     ORGLET_PASSWORD (x), API_VERSION (59.0).
"""
import json
import os
import sys

import requests
from simple_salesforce import Salesforce, SalesforceLogin
from simple_salesforce.exceptions import SalesforceError

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8095")
USERNAME = os.environ.get("ORGLET_USERNAME", "admin@orglet.local")
PASSWORD = os.environ.get("ORGLET_PASSWORD", "x")
API_VERSION = os.environ.get("API_VERSION", "59.0")


class HttpRewriteSession(requests.Session):
    """Copied from conformance/python/run.py: simple_salesforce always builds https:// URLs,
    while a local orglet speaks plain HTTP."""

    def request(self, method, url, *args, **kwargs):
        if url.startswith("https://"):
            url = "http://" + url[len("https://"):]
        return super().request(method, url, *args, **kwargs)


def first_error(exc):
    content = exc.content[0] if isinstance(exc.content, list) and exc.content else {}
    return content.get("errorCode"), content.get("message", "")


def rejected(fn):
    """True when the call raises a 400 or returns success false."""
    try:
        res = fn()
    except SalesforceError as exc:
        return exc.status == 400
    return isinstance(res, dict) and res.get("success") is False


def main():
    session = HttpRewriteSession()
    session_id, _instance = SalesforceLogin(username=USERNAME, password=PASSWORD, sf_version=API_VERSION, scratch_url=BASE_URL, session=session)
    sf = Salesforce(session_id=session_id, instance_url=BASE_URL, version=API_VERSION, session=session)

    results = []
    created = []

    def check(name, fn):
        try:
            ok, detail = fn()
        except Exception as exc:  # noqa: BLE001 - a harness reports every failure and moves on
            results.append(False)
            print(f"FAIL {name} {type(exc).__name__}: {exc}")
            return
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'} {name} {detail if isinstance(detail, str) else json.dumps(detail, separators=(',', ':'), default=str)}")

    try:
        desc = sf.Support_Tier__mdt.describe()
        q = sf.query("SELECT Id, DeveloperName, MasterLabel, Code__c, Max_Seats__c, Is_Active__c, Region__c FROM Support_Tier__mdt ORDER BY DeveloperName")
        by_name = {r["DeveloperName"]: r for r in q["records"]}
        gold = by_name["Gold"]

        def describe_mdt():
            names = [f["name"] for f in desc["fields"]]
            need = ["Id", "DeveloperName", "MasterLabel", "Label", "Language", "NamespacePrefix", "QualifiedApiName", "IsProtected", "SystemModstamp"]
            ok = (not desc["createable"] and not desc["updateable"] and not desc["deletable"] and not desc["undeletable"]
                  and desc["queryable"] and desc["retrieveable"] and desc["custom"] and desc["customSetting"] is False
                  and str(desc["keyPrefix"]).startswith("m")
                  and all(n in names for n in need) and not any(n in names for n in ("Name", "OwnerId", "IsDeleted")))
            return ok, {"keyPrefix": desc["keyPrefix"], "createable": desc["createable"], "customSetting": desc["customSetting"], "missing": [n for n in need if n not in names]}

        def query_values():
            names = [r["DeveloperName"] for r in q["records"]]
            ok = (q["totalSize"] == 3 and names == ["Bronze", "Gold", "Silver"]
                  and by_name["Gold"]["Code__c"] == "007" and by_name["Silver"]["Code__c"] is None
                  and by_name["Gold"]["Max_Seats__c"] == 50 and by_name["Bronze"]["Max_Seats__c"] is None
                  and by_name["Silver"]["Region__c"] is None and by_name["Bronze"]["Is_Active__c"] is False
                  and by_name["Silver"]["MasterLabel"] == "Silver Tier"
                  and all(len(r["Id"]) == 18 and r["Id"].startswith(desc["keyPrefix"]) for r in q["records"]))
            return ok, {"names": names, "ids": [r["Id"] for r in q["records"]]}

        def retrieve():
            r = sf.Support_Tier__mdt.get(gold["Id"])
            ok = (r["DeveloperName"] == "Gold" and r["QualifiedApiName"] == "Gold" and r["Label"] == "Gold"
                  and r["Language"] == "en_US" and r["NamespacePrefix"] is None)
            return ok, {k: r.get(k) for k in ("DeveloperName", "QualifiedApiName", "Label", "Language", "NamespacePrefix")}

        def relationships():
            t = sf.query("SELECT DeveloperName, Tier_Group__c, Tier_Group__r.DeveloperName, Target_Object__c, Target_Object__r.QualifiedApiName, Target_Field__c FROM Support_Tier__mdt ORDER BY DeveloperName")["records"]
            g = sf.query("SELECT DeveloperName, Default_Tier__r.DeveloperName FROM Tier_Group__mdt ORDER BY DeveloperName")["records"]
            tb = {r["DeveloperName"]: r for r in t}
            gb = {r["DeveloperName"]: r for r in g}
            ok = ((tb["Gold"].get("Tier_Group__r") or {}).get("DeveloperName") == "Premium" and tb["Gold"]["Target_Object__c"] == "Account"
                  and (tb["Gold"].get("Target_Object__r") or {}).get("QualifiedApiName") == "Account" and tb["Gold"]["Target_Field__c"] == "Account.Industry"
                  and tb["Bronze"]["Tier_Group__c"] is None and tb["Bronze"]["Target_Object__c"] is None and tb["Bronze"]["Target_Field__c"] is None
                  and (gb["Premium"].get("Default_Tier__r") or {}).get("DeveloperName") == "Gold"
                  and (gb["Standard"].get("Default_Tier__r") or {}).get("DeveloperName") == "Silver")
            return ok, {"gold": tb["Gold"], "bronze": tb["Bronze"]}

        def entity_definition_only():
            try:
                sf.query("SELECT Target_Object__r.Label FROM Support_Tier__mdt")
            except SalesforceError as exc:
                code, message = first_error(exc)
                return code == "INVALID_FIELD" and "UNSUPPORTED:entity-definition" in message, {"errorCode": code, "message": message}
            return False, "query was accepted"

        def dml_rejected():
            c = rejected(lambda: sf.Support_Tier__mdt.create({"DeveloperName": "Probe", "MasterLabel": "Probe"}))
            u = rejected(lambda: sf.Support_Tier__mdt.update(gold["Id"], {"MasterLabel": "Changed"}))
            d = rejected(lambda: sf.Support_Tier__mdt.delete(gold["Id"]))
            count = sf.query("SELECT COUNT() FROM Support_Tier__mdt")["totalSize"]
            label = sf.Support_Tier__mdt.get(gold["Id"])["MasterLabel"]
            return c and u and d and count == 3 and label == "Gold", {"create": c, "update": u, "delete": d, "count": count, "label": label}

        def setting_describe():
            app = sf.App_Config__c.describe()
            lst = sf.Region_List__c.describe()
            names = lambda d: [f["name"] for f in d["fields"]]  # noqa: E731
            owner = next((f for f in app["fields"] if f["name"] == "SetupOwnerId"), {})
            ok = (app["customSetting"] is True and lst["customSetting"] is True
                  and "OwnerId" not in names(app) and "OwnerId" not in names(lst)
                  and sorted(owner.get("referenceTo", [])) == ["Organization", "Profile", "User"]
                  and "SetupOwnerId" not in names(lst))
            return ok, {"app": app["customSetting"], "list": lst["customSetting"], "referenceTo": owner.get("referenceTo")}

        def hierarchy_duplicate():
            first = sf.App_Config__c.create({"Feature_Enabled__c": True})
            if not first.get("success"):
                return False, {"first": first}
            created.append(first["id"])
            code = None
            was_rejected = False
            try:
                second = sf.App_Config__c.create({"Endpoint__c": "https://example.invalid"})
                if second.get("success"):
                    created.append(second["id"])
                else:
                    was_rejected = True
                    code = (second.get("errors") or [{}])[0].get("statusCode")
            except SalesforceError as exc:
                was_rejected = True
                code, _ = first_error(exc)
            rows = sf.query("SELECT SetupOwnerId FROM App_Config__c")
            ok = (was_rejected and code == "DUPLICATE_VALUE" and rows["totalSize"] == 1
                  and str(rows["records"][0]["SetupOwnerId"]).startswith("00D"))
            return ok, {"errorCode": code, "rows": [r["SetupOwnerId"] for r in rows["records"]]}

        check("describe-mdt", describe_mdt)
        check("query-values", query_values)
        check("retrieve", retrieve)
        check("relationships", relationships)
        check("entity-definition-only", entity_definition_only)
        check("dml-rejected", dml_rejected)
        check("setting-describe", setting_describe)
        check("hierarchy-duplicate", hierarchy_duplicate)
    except Exception as exc:  # noqa: BLE001
        results.append(False)
        print(f"FAIL setup {type(exc).__name__}: {exc}")
    finally:
        for rid in created:
            try:
                sf.App_Config__c.delete(rid)
            except Exception:  # noqa: BLE001
                pass

    passed = sum(1 for r in results if r)
    print(f"simple-salesforce: {passed}/8 passed")
    sys.exit(0 if passed == 8 and len(results) == 8 else 1)


if __name__ == "__main__":
    main()
