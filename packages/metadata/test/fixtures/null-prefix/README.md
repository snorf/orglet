# null-prefix fixture

Test-only, baseline-shaped objects proving that a null key prefix is first-class (D-08..D-12). They are never
part of the real baseline in `packages/metadata/standard`.

Load with `loadBaseline(<this dir>)` and concatenate onto the real baseline:
`buildOrgSchema({ ...real, objects: [...real.objects, ...fixture.objects] })`.

`0zz` is an invented test prefix and must never be copied into `packages/metadata/standard`.
