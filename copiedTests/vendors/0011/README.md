# Remove vendor-specific `transition` properties (before duration optimization)

No modern browser requires vendor prefixes for the `transition` property. Since
there is also a `transition` property with an identical value that overrides the
vendored versions, it is safe to remove all of them and just keep the native
`transition`. Then apply any value optimizations, like `300ms` -> `.3s`.
