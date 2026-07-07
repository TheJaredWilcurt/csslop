/**
 * @file Defines lookup tables mapping CSS shorthand properties to their constituent longhand properties and override relationships.
 */

const shorthandMap = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  overflow: ['overflow-x', 'overflow-y'],
  gap: ['row-gap', 'column-gap'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color'],
  'border-image': ['border-image-source', 'border-image-slice', 'border-image-repeat'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'background-position': ['background-position-x', 'background-position-y'],
  background: ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-position-x', 'background-position-y', 'background-attachment', 'background-size', 'background-origin', 'background-clip'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  columns: ['column-width', 'column-count'],
  'list-style': ['list-style-position', 'list-style-image', 'list-style-type'],
  'margin-inline': ['margin-inline-start', 'margin-inline-end'],
  'margin-block': ['margin-block-start', 'margin-block-end'],
  'padding-inline': ['padding-inline-start', 'padding-inline-end'],
  'padding-block': ['padding-block-start', 'padding-block-end'],
  'inset-inline': ['inset-inline-start', 'inset-inline-end'],
  'inset-block': ['inset-block-start', 'inset-block-end'],
  'border-inline': ['border-inline-start', 'border-inline-end', 'border-inline-width', 'border-inline-style', 'border-inline-color'],
  'border-block': ['border-block-start', 'border-block-end', 'border-block-width', 'border-block-style', 'border-block-color'],
  'border-inline-width': ['border-inline-start-width', 'border-inline-end-width'],
  'border-block-width': ['border-block-start-width', 'border-block-end-width'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  mask: ['mask-image', 'mask-repeat', 'mask-size'],
  'position-try': ['position-try-order', 'position-try-fallbacks'],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family']
};

const shorthandOverrideMap = {
  border: ['border-image', 'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'],
  font: ['font-variant', 'font-variant-alternates', 'font-variant-caps', 'font-variant-east-asian', 'font-variant-ligatures', 'font-variant-numeric', 'font-variant-position'],
  mask: ['mask-border', 'mask-border-source', 'mask-border-slice', 'mask-border-width', 'mask-border-outset', 'mask-border-repeat', 'mask-border-mode']
};

export {
  shorthandMap,
  shorthandOverrideMap
};
