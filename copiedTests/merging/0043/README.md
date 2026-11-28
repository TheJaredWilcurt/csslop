# Merge identical rules after unwrapping useless `:is()`

The `:is(div, span)` contains two tag selectors that are known-good and the same
specificity, making them safe to unwrap to `div,span`. This rule then can be
merged with the prior rule that has the same selectors. Since the second rule
only contains property/value pairs already represented in the first rule, their
merging effectively removes the second rule.
