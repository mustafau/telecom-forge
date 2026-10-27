# Dependency map

`telecom-api-sandbox` may read `shared-contracts`. The trusted catalog does not currently declare a `depends_on` edge, so a task must name `shared-contracts` in `context_repositories` when it needs that checkout.

Do not assume a shared build tool. Each repository uses the build profile named in the catalog.
