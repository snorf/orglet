#!/usr/bin/env python3
"""
files-check, simple-salesforce leg: uploads a ContentVersion as base64 JSON (random 64 KiB),
reads the exact bytes back with get_base64, checks the server-computed fields, the mandatory
ContentDocumentLink filter and the delete cascade. One PASS/FAIL line per check; exit 1 on any
FAIL. Everything created is deleted again at the end.

Usage: BASE_URL=http://localhost:8082 python sf_files.py
Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
     ORGLET_PASSWORD (x), API_VERSION (59.0).
"""
import base64
import hashlib
import json
import os
import sys

import requests
from simple_salesforce import Salesforce, SalesforceLogin
from simple_salesforce.exceptions import SalesforceError

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8081")
USERNAME = os.environ.get("ORGLET_USERNAME", "admin@orglet.local")
PASSWORD = os.environ.get("ORGLET_PASSWORD", "x")
API_VERSION = os.environ.get("API_VERSION", "59.0")
EXPECTED = 5


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

    data = os.urandom(64 * 1024)
    results = []
    state = {"version": None, "document": None}

    def check(name, fn):
        try:
            ok, detail = fn()
        except Exception as exc:  # noqa: BLE001 - a harness reports every failure and moves on
            results.append(False)
            print(f"FAIL {name} {type(exc).__name__}: {exc}")
            return
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'} {name} {detail if isinstance(detail, str) else json.dumps(detail, separators=(',', ':'))}")

    def upload_json():
        r = sf.ContentVersion.create({
            "Title": "files-check",
            "PathOnClient": "files-check.bin",
            "VersionData": base64.b64encode(data).decode("ascii"),
        })
        state["version"] = r["id"]
        return bool(r.get("success")) and bool(r["id"]), r

    def computed_fields():
        rec = sf.ContentVersion.get(state["version"])
        state["document"] = rec["ContentDocumentId"]
        url = f"/services/data/v{API_VERSION}/sobjects/ContentVersion/{state['version']}/VersionData"
        ok = (rec["Checksum"] == hashlib.md5(data).hexdigest()
              and rec["ContentSize"] == len(data)
              and rec["FileType"] == "UNKNOWN"
              and rec["VersionData"] == url)
        return ok, {"Checksum": rec["Checksum"], "ContentSize": rec["ContentSize"], "FileType": rec["FileType"], "VersionData": rec["VersionData"]}

    def get_base64():
        got = sf.ContentVersion.get_base64(state["version"], "VersionData")
        return got == data, {"bytes": len(got), "expected": len(data)}

    def link_filter_required():
        try:
            sf.query("SELECT Id FROM ContentDocumentLink")
        except SalesforceError as exc:
            content = exc.content[0] if isinstance(exc.content, list) and exc.content else {}
            return content.get("errorCode") == "MALFORMED_QUERY", {"errorCode": content.get("errorCode"), "message": content.get("message")}
        return False, "query was accepted"

    def delete_cascade():
        doc = state["document"]
        sf.ContentDocument.delete(doc)
        state["document"] = None
        r = sf.query_all(f"SELECT Id FROM ContentVersion WHERE ContentDocumentId = '{doc}'")
        return r["totalSize"] == 0, {"totalSize": r["totalSize"]}

    try:
        check("upload-json", upload_json)
        if not state["version"]:
            raise RuntimeError("upload-json produced no ContentVersion; remaining checks cannot run")
        check("computed-fields", computed_fields)
        check("get-base64", get_base64)
        check("link-filter-required", link_filter_required)
        check("delete-cascade", delete_cascade)
    except Exception as exc:  # noqa: BLE001
        results.append(False)
        print(f"FAIL setup {type(exc).__name__}: {exc}")
    finally:
        if state["document"]:
            try:
                sf.ContentDocument.delete(state["document"])
            except Exception:  # noqa: BLE001
                pass

    passed = sum(1 for r in results if r)
    print(f"simple-salesforce: {passed}/{EXPECTED} passed")
    sys.exit(0 if passed == EXPECTED and len(results) == EXPECTED else 1)


if __name__ == "__main__":
    main()
