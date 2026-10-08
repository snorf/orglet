#!/usr/bin/env python3
"""
describe-check, simple-salesforce leg: runs describe() (global) and <Object>.describe() through
simple-salesforce for each object in objects.txt (or the names given as arguments) against a
running orglet, and checks every property in contract.json. One PASS/FAIL line per object;
exit 1 on any FAIL.

Usage: BASE_URL=http://localhost:8081 python sf_describe.py [Object ...]
Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
     ORGLET_PASSWORD (x), API_VERSION (59.0).
"""
import json
import os
import sys
from pathlib import Path

import requests
from simple_salesforce import Salesforce, SalesforceLogin

HERE = Path(__file__).resolve().parent
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8081")
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


def missing(obj, keys):
    return [k for k in keys if not isinstance(obj, dict) or k not in obj]


def problems_for(name, global_entry, d, contract):
    p = []
    if global_entry is None:
        p.append("missing from describe()['sobjects']")
    else:
        p += [f"global.{k}" for k in missing(global_entry, contract["globalSObjectKeys"])]
    p += [f"describe.{k}" for k in missing(d, contract["globalSObjectKeys"] + contract["sobjectDescribeKeys"])]
    if d.get("name") != name:
        p.append(f"describe.name is {d.get('name')}")
    if not isinstance(d.get("keyPrefix"), str) or len(d["keyPrefix"]) != 3:
        p.append(f"keyPrefix {d.get('keyPrefix')}")
    p += [f"urls.{k}" for k in missing(d.get("urls"), contract["urlKeys"])]
    fields = d.get("fields") or []
    for f in fields:
        p += [f"fields.{f.get('name')}.{k}" for k in missing(f, contract["fieldKeys"])]
    for s in contract["systemFields"]:
        if sum(1 for f in fields if f.get("name") == s) != 1:
            p.append(f"system field {s}")
    name_fields = [f for f in fields if f.get("nameField") is True]
    if len(name_fields) > 1:
        p.append(f"{len(name_fields)} nameField fields")
    for c in d.get("childRelationships") or []:
        p += [f"childRelationships.{c.get('childSObject')}.{k}" for k in missing(c, contract["childRelationshipKeys"])]
    return p


def main():
    contract = json.loads((HERE / "contract.json").read_text())
    listed = [l.strip() for l in (HERE / "objects.txt").read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    objects = sys.argv[1:] or listed

    session = HttpRewriteSession()
    session_id, _instance = SalesforceLogin(username=USERNAME, password=PASSWORD, sf_version=API_VERSION, scratch_url=BASE_URL, session=session)
    sf = Salesforce(session_id=session_id, instance_url=BASE_URL, version=API_VERSION, session=session)
    global_entries = {s["name"]: s for s in sf.describe()["sobjects"]}

    failed = 0
    for name in objects:
        try:
            d = getattr(sf, name).describe()
            p = problems_for(name, global_entries.get(name), d, contract)
        except Exception as exc:  # noqa: BLE001 - a harness reports every failure and moves on
            d, p = None, [f"{type(exc).__name__}: {exc}"]
        if p:
            failed += 1
            print(f"FAIL {name} {'; '.join(p)}")
        else:
            nf = next((f["name"] for f in d["fields"] if f.get("nameField") is True), "-")
            print(f"PASS {name} keyPrefix={d['keyPrefix']} nameField={nf} fields={len(d['fields'])} childRelationships={len(d['childRelationships'])}")
    print(f"simple-salesforce: {len(objects) - failed}/{len(objects)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
