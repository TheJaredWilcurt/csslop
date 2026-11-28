# Replace duplicate rule with multiple selectors after other optimizations

First convert the border properties to a `border` shorthand which will cause
both rules to be an exact match, then remove the first one.
