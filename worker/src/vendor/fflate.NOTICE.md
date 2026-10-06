This directory vendors the synchronous DEFLATE codec from fflate 0.8.2
(https://github.com/101arrowz/fflate), MIT license in fflate.LICENSE.
Only deflateSync and inflateSync are included; no network or Node APIs.

npm tarball SHA-256: 61fd5061e2fc8e5e3e3129f7f2fec7bd78a313e1bf4becbf1cc1cc9998d141dc
Upstream esm/browser.js SHA-256: 8cc1f687e0159e977addb6b85e274dbd11e622cf151f4fcb7b85d49622ea43e7

Rebuild using esbuild 0.28.1 with an entry that exports
`{deflateSync,inflateSync}` from the package's `esm/browser.js`:
`esbuild entry.js --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=fflate.js`
