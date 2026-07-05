/**
 * @file Runs all the real world CSS files through CSSLOP, skipping ones that
 *       have been minified before, based on the realWorldResults.json and the
 *       cached output in the /tests/minified folder. Delete those locations
 *       to do a full re-run of all tests (4+ hours). Which may result in
 *       different outputs based on improvements made in /src.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import prettyMilliseconds from 'pretty-ms';
import getRealWorldCSS from 'real-world-css-libraries';

import { minifyCSS } from '../index.js';

const realTimeStart = Date.now();
const __dirname = import.meta.dirname;
const minifiedPath = join(__dirname, 'minified');
const reportPath = join(__dirname, '..', 'realWorldResults.json');

/**
 * Runs all real world tests, reports outcome to console and saves to JSON.
 */
function runAndReportRealWorldTests () {
  function deleteOldMinifiedFiles (libraries) {
    const libraryNames = libraries.map((library) => {
      return library.fileName;
    });
    const existingMinifiedFiles = readdirSync(minifiedPath);
    for (const existingFile of existingMinifiedFiles) {
      if (!libraryNames.includes(existingFile)) {
        unlinkSync(join(minifiedPath, existingFile));
      }
    }
  }

  function loadRealWorldTests () {
    let existingReport = {};
    if (existsSync(reportPath)) {
      existingReport = JSON.parse(readFileSync(reportPath));
    }
    const librariesReport = existingReport.libraries || [];

    const includeFileName = true;
    let libraries = getRealWorldCSS(includeFileName);
    deleteOldMinifiedFiles(libraries);

    // Combine existing report data.
    libraries = libraries.map((library) => {
      const report = librariesReport.find((reportLibrary) => {
        return (
          reportLibrary.name === library.name &&
          reportLibrary.version === library.version
        );
      });
      return {
        ...library,
        ...(report || {})
      };
    });
    return libraries;
  }

  function getPaddingLength (libraries) {
    let longestName = 0;
    libraries.forEach((library) => {
      const length = library.name.length;
      if (longestName < length) {
        longestName = length;
      }
    });
    return longestName;
  }

  function runRealWorldTests (libraries) {
    function runOneTest ({ fileAlreadyExists, i, libraries, outputFile, padding }) {
      const library = libraries[i];
      let output;
      let duration;
      if (fileAlreadyExists) {
        output = String(readFileSync(outputFile)).trim();
        duration = library.duration;
      } else {
        console.log(
          '\n' +
          library.name.padEnd(padding) +
          ' - ' +
          library.source.length +
          ' - ' +
          ((i + 1) + '/' + libraries.length)
        );
        const start = Date.now();
        output = minifyCSS(library.source);
        duration = Date.now() - start;
      }
      return {
        output,
        duration
      };
    }

    function logOneTest ({ duration, fileAlreadyExists, library, output, padding }) {
      const percent = Math.round((output.length / library.source.length) * 100);
      if (!fileAlreadyExists) {
        const difference = library.source.length - output.length;
        console.log(
          ((duration / 1000) + 's').padEnd(padding) +
          ' - ' +
          output.length +
          ' (-' + difference + ', ' + percent + '%)'
        );
      }
      return { percent };
    }

    const padding = getPaddingLength(libraries);
    const mutatedLibraries = [];

    for (let i = 0; i < libraries.length; i++) {
      const library = libraries[i];
      const outputFile = join(minifiedPath, library.fileName);
      const fileAlreadyExists = existsSync(outputFile);

      const { output, duration } = runOneTest({
        fileAlreadyExists,
        i,
        libraries,
        outputFile,
        padding
      });

      const { percent } = logOneTest({
        fileAlreadyExists,
        duration,
        library,
        output,
        padding
      });

      library.duration = duration;
      library.inputSize = library.source.length;
      library.outputSize = output.length;
      library.percent = percent;
      library.output = output;
      delete library.size;
      delete library.source;
      delete library.url;
      mutatedLibraries.push(library);
    }
    return mutatedLibraries;
  }

  function reportRealWorldTests (libraries) {
    let totalInput = 0;
    let totalOutput = 0;
    let totalDuration = 0;
    libraries.forEach((library) => {
      if (library.duration === undefined) {
        console.log({ library });
      }
      totalInput = totalInput + library.inputSize;
      totalOutput = totalOutput + library.outputSize;
      totalDuration = totalDuration + library.duration;
    });

    console.log('TOTAL DURATION: ' + prettyMilliseconds(totalDuration));
    console.log('TOTAL INPUT: ' + (Math.round(totalInput / 1024 / 1024 * 100) / 100) + 'MB');
    console.log('TOTAL OUTPUT: ' + (Math.round(totalOutput / 1024 / 1024 * 100) / 100) + 'MB');

    for (const library of libraries) {
      writeFileSync(join(minifiedPath, library.fileName), library.output + '\n');
      delete library.fileName;
      delete library.output;
      delete library.license;
    }

    const report = JSON.stringify({
      totals: {
        inputSize: totalInput,
        outputSize: totalOutput,
        duration: totalDuration,
        durationHuman: prettyMilliseconds(totalDuration),
        percent: Math.round((totalOutput / totalInput) * 100) + '%'
      },
      libraries
    }, null, 2);
    writeFileSync(reportPath, report + '\n');

    console.log('REAL TIME: ' + prettyMilliseconds(Date.now() - realTimeStart));
  }

  mkdirSync(minifiedPath, { recursive: true });
  const libraries = loadRealWorldTests();
  const mutatedLibraries = runRealWorldTests(libraries);
  reportRealWorldTests(mutatedLibraries);
}

runAndReportRealWorldTests();
