import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import getRealWorldCSS from 'real-world-css-libraries';

import { minifyCSS } from '../../index.js';

const __dirname = import.meta.dirname;

let libraries = getRealWorldCSS();

let longestName = 0;
libraries.forEach((library) => {
  const length = library.name.length;
  if (longestName < length) {
    longestName = length;
  }
});

for (let i = 0; i < libraries.length; i++) {
  const library = libraries[i];
  const start = Date.now();
  console.log('');
  console.log(
    library.name.padEnd(longestName) +
    ' - ' +
    library.source.length +
    ' - ' +
    (i + 1) +
    '/' +
    libraries.length
  );
  const output = minifyCSS(library.source);
  const duration = Date.now() - start;
  const difference = library.source.length - output.length;
  const percent = Math.round((output.length / library.source.length) * 100);
  console.log(
    ((duration / 1000) + 's').padEnd(longestName) +
    ' - ' +
    output.length +
    ' - ' +
    difference +
    ' - ' +
    percent + '%'
  );
  library.duration = duration;
  library.inputSize = library.source.length;
  library.outputSize = output.length;
  library.percent = percent;
  library.output = output;
  delete library.size;
  delete library.source;
}

let totalInput = 0;
let totalOutput = 0;
let totalDuration = 0;
libraries.forEach((library) => {
  totalInput = totalInput + library.inputSize;
  totalOutput = totalOutput + library.outputSize;
  totalDuration = totalDuration + library.duration;
});
function timeFromMs (ms) {
  const hour = Math.floor(ms / 1000 / 60 / 60);
  const hourToSubtract = hour * 1000 * 60 * 60;
  let remaining = ms - hourToSubtract;
  const minute = Math.floor(remaining / 1000 / 60);
  let minuteToSubtract = minute * 1000 * 60;
  remaining = remaining - minuteToSubtract;
  let second = remaining / 1000;
  return (
    hour +
    ':' +
    ('' + minute).padStart(2, '0') +
    ':' +
    (('' + second).split('.')[0]).padStart(2, '0') +
    '.' +
    (('' + second).split('.')[1] || '').padEnd(3, '0')
  );
}

console.log('TOTAL DURATION: ' + timeFromMs(totalDuration));
console.log('TOTAL INPUT: ' + (Math.round(totalInput / 1024 / 1024 * 100) / 100) + 'MB');
console.log('TOTAL OUTPUT: ' + (Math.round(totalOutput / 1024 / 1024 * 100) / 100) + 'MB');

for (const library of libraries) {
  writeFileSync(join(__dirname, 'minified', library.fileName), library.output + '\n');
  delete library.fileName;
  delete library.output;
  delete library.license;
}

const reportPath = join(__dirname, '..', '..', 'realWorldResults.json');
const report = JSON.stringify({
  totals: {
    inputSize: totalInput,
    outputSize: totalOutput,
    duration: totalDuration,
    durationHuman: timeFromMs(totalDuration),
    percent: Math.round((totalOutput / totalInput) * 100) + '%'
  },
  libraries
}, null, 2);
writeFileSync(reportPath, report + '\n');
