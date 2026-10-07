# CAA records for treforged.com (ask 21d5dd90)

**State on 2026-10-07:** `dns.google` returns NO CAA records for `treforged.com`
or `www.treforged.com`, so any public CA may issue a certificate for the domain.
DNS is on Cloudflare (`dolly`/`grant.ns.cloudflare.com`).

**Live certificate issuers, measured the same day with `openssl s_client`:**

| Host | Issuer |
| --- | --- |
| treforged.com | Google Trust Services (WE1) - Cloudflare Universal SSL |
| www.treforged.com | Google Trust Services (WE1) - Cloudflare Universal SSL |
| getforgenta.com (for comparison) | Let's Encrypt (YE2) |

## The records

Add in Cloudflare -> treforged.com -> DNS -> Records -> Add record, type CAA,
name `@` (the apex; CAA is inherited by `www` and every subdomain):

| Name | Flags | Tag | Value | Why |
| --- | --- | --- | --- | --- |
| @ | 0 | issue | `pki.goog` | Google Trust Services - issues today's edge cert |
| @ | 0 | issue | `letsencrypt.org` | Cloudflare's other Universal SSL CA, and GitHub Pages' CA for the origin cert |
| @ | 0 | issue | `ssl.com` | Cloudflare Universal SSL CA |
| @ | 0 | issue | `sectigo.com` | Cloudflare Universal SSL / backup CA |
| @ | 0 | iodef | `mailto:contact@treforged.com` | Where a CA reports a refused request |

No `issuewild` record: without one, the `issue` list also governs wildcards,
which is what Cloudflare's `*.treforged.com` edge cert needs.

**Why four CAs and not two.** Cloudflare rotates Universal SSL between its CAs
on renewal. A CAA set naming only today's issuer breaks the NEXT renewal, not
this one - the failure arrives weeks later with nothing pointing back here.
Cloudflare also adds its own CA records automatically once any CAA record
exists, so naming them explicitly costs nothing and makes the set readable.

## Verify

    curl -s "https://dns.google/resolve?name=treforged.com&type=CAA"

The `Answer` array must list all five values. Then check renewal still works:
Cloudflare -> SSL/TLS -> Edge Certificates must show the Universal certificate
as Active, and GitHub repo Settings -> Pages must still show the HTTPS
certificate as valid.

## Undo

Delete the five CAA records. With no CAA records, every CA may issue again -
the exact state before this change.

## Why it was not applied by a desk

No Cloudflare API token exists on this machine (re-checked 2026-10-07: no
`CLOUDFLARE_API_TOKEN` or `CF_*` in the environment, no `wrangler`/`flarectl`,
no `~/.wrangler`). The connected Cloudflare MCP covers Workers/KV/R2/D1 only, not
DNS. So it needs one dashboard visit, about two minutes.
