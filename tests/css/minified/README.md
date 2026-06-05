`realworld.test.js` loops over the list of CSS files included in
`real-world-css-libraries`, and has CSSLOP minify each, storing
them in this folder to track changes over time, as improvements
are made to CSSLOP over time.

**Notes:**

* `System-v0.1.11.css` - reported upstream https://github.com/keithamus/css-minify-tests/issues/70
  * Technically this code in System comes from 98, so it is impacted too
* Files with the same output as input that need investigated:
  * `bojler-v3.2.1.css`
  * `google-type-v0.0.0.css`
  * `halfstyle-v2.0.2.css`
  * `nes-v2.3.0.css`
  * `tablecloth-v1.10.0.css`
  * `tailwind-v2.2.19.css`
* Files with empty outputs that need investigated:
  * `css-extras-v0.4.0.css`
  * `github-dark-v6.3.0.css`
  * `github-windows-v0.6.0.css`
