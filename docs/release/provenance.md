# Source provenance and distribution decisions

Reviewed 2026-09-06. This records evidence, not a legal certification.

## Verified Sites template match

The official npm package `@openai/create-sites@0.3.0` contains an MIT license
with copyright OpenAI 2026. Its complete text is preserved in
[`LICENSES/OpenAI-create-sites-MIT.txt`](../../LICENSES/OpenAI-create-sites-MIT.txt),
independently of installed dependency inventories (the generator is not a
LucasCad runtime dependency).

Artifact: <https://registry.npmjs.org/@openai/create-sites/-/create-sites-0.3.0.tgz>

Registry integrity, verified against the downloaded archive:

```
sha512-eq3z9/toJPd6Hy2eYsk2R/uQdzZB7p7RnmfXbnKF13AbHFkwmgm4/lFG6UBCPmngv2w7pMO7y+DiEMxS39czlQ==
```

The following files have identical TypeScript syntax trees to the indicated
package templates, ignoring comments, formatting, quote style and trailing
commas. Comparison retained node kinds, identifiers and literal values.
This identifies a licensed matching source, not proof of which initializer
version originally created this repository.

| LucasCad file | Path inside package |
| --- | --- |
| `app/chatgpt-auth.ts` | `templates/addons/auth/app/chatgpt-auth.ts` |
| `db/index.ts` | `templates/addons/d1/db/index.ts` |
| `db/schema.ts` | `templates/addons/d1/db/schema.ts` |
| `drizzle.config.ts` | `templates/addons/d1/drizzle.config.ts` |
| `next.config.ts` | `templates/vinext/next.config.ts` |

`vite.config.ts` also shares the template's Sites/Cloudflare binding setup,
with local CAD ports/watch settings and the retained custom Worker entry.
The MIT notice applies to those template-derived portions, not to all LucasCad
code. LucasCad-original code remains GPL-3.0-only.

The old custom `worker/index.ts` is not present in that template package.
A matching file in another public project is not sufficient ownership evidence.
Its original template attribution remains an open provenance item; do not
mistake the installed Vinext library's MIT license for a verified license
of every copied wrapper. No runtime behavior was removed to mask this question.

## Archive hygiene versus repository visibility

`.gitattributes` omits `examples/chalis.json`, diagnostic image/mesh exports,
and local-environment/output directories from `git archive` source packages.
No model was deleted. Generated JSON regression fixtures and their construction
scripts remain included so the test suite is reproducible. These exclusions do
not hide files from GitHub browsing, Git clones, forks or earlier commits.
Source archives are still provisional: public model/asset rights review and
the remaining wrapper attribution must be resolved before public distribution.

Do not make the existing repository public on the strength of an archive filter.
Historical personal paths and old starter assets remain. A sanitized publication
requires a separate owner-approved plan; this cleanup does not authorize a
history rewrite, force-push, or deletion of local models.

## Installer hold: exact question to resolve

Before distributing a bundled environment, obtain version-specific evidence for
CasADi 3.7.2's METIS/solver binaries and compatible corresponding sources. The
wheel ships both an EPL build-harness notice and a separate legacy METIS 4
notice. COIN-OR's older author correspondence is useful but does not establish
a universal GPL-compatible redistribution grant for the exact compiled files.

Suggested upstream question (not sent): Which METIS source revision and license
grant cover the binaries in the Windows CasADi 3.7.2 wheel? Is redistribution in
a GPLv3 application installer permitted, and where are the corresponding source,
patches and build instructions for those binaries and the other bundled solvers?

Then record source/notice/replacement obligations for OCCT, CasADi, libvips and
other LGPL/MPL components on each target platform. Do not swap the CAD kernel
or solver stack merely to silence the audit without a compatibility decision.
