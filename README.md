# CSSLOP

Experimental vibe-coded CSS minification library

**The experiment:**

* Use the tests from the open source, 3rd-party, CSS minification auditing library `css-minify-tests`.
* Have AI completely generate the library logic to pass all tests.
* Have me (an experience library author) validate the outcomes and make upstream corrections to the tests library.

**The Results:**

* All tests pass.
* Several new tests were created upstream, and some existing tests were improved/fixed upstream (all manually by me, no AI used).
* The `src` folder is 100% vibe coded, and despite passing all tests, is almost certainly not worth using. Though if you do, and you find issues, you can report them and I might tell the AI's to fix it.
* No AI generated code exists outside of the `src` folder, this README, for example, is 100% human crafted.

**AI's used:**

* Claude Opus 4.6 (Thinking)
* Claude Sonnet 4.6 (Thinking)
* Gemini 3.1 Pro (High Thinking)
* GPT-5.4 High (Thinking)

These tools were prompted to pass the tests based in the `/copiedTests` folder that come from `keithamus/css-minify-tests`.

**Summary of project phases:**

1. **Human setup:** I set up the repo like I would any of my libraries. with entry points and folder structure. Created a script to pull in all the tests to the `copiedTests` folder. Wrote a simple `/tests` file to loop over and run all the copied tests, then output which sections were failing so I could track as the AI's tried to get more tests to pass.
1. **Human code:** I tried out several Node.js-based CSS parsers until I found the most up-to-date one I could. I then used it to solve one very simple test to lay the groundwork for the broad direction of input/parse/transform/output. Ran the tests, and 12% were passing. Commit.
1. **AI Broad strokes:** I had several AI's attempt to write the entire library in one-go, telling it to make all the tests pass. Both Claudes and Gemini ran for over an hour before giving up with no file changes. GPT-5.4 gave up after a while, but did manage to make some progress, doubling the passing tests to 24%.
1. **AI Test groups:** At this point, it was clear, that they couldn't handle this big of a task. To be fair, as a human, it would probably have taken me 4-6 months to do the work I was asking it to do in one prompt, and I wouldn't have done all that work in a single commit. So at this point, I began the process of asking the AI's to fix all the tests in a specific folder (escaping, comments, keyframes, merging, etc.). The tests were already organized by category, so having them focus on just one similarly related concept was much easier for the AIs. Because there were 29 folders, I cycled through the AI's, letting them each fix a test group. Some of the folders, like "values", with 70 tests, and 55 of them failing, were still too big for Claude to handle, and I had to go back to Gemini or GPT for these. And even then, sometimes they couldn't solve all of them, but would make progress before I had to turn it over to a different AI to continue onward with the remaining test fixes in that folder.
1. **Human test corrections:** While the AI's were trying to write code to pass the tests, I was investigating the tests themselves and fixing issues with them upstream. Some tests had incorrect assumptions and needed re-written or improved. Some were missing edge cases that a human developer would likely cover during implementation, but these AI's were absolutely skipping doing any work they didn't have to in order to get the tests to pass. Fortunately, the maintainer of the tests repo was always very quick to respond and merge these PRs. Cool dude.
1. **AI organization:** After all tests were finally passing (took several days of babysitting). I had GPT-5.4 re-organize the code. It did fine, I'd give it a C-. But huge improvement over having the entire library in one ~2000 line file. I went with GPT because of the 4 I tested, it seems to be the only one capable of handling large, complex tasks in one-go. Even if the output is mediocre, at least it doesn't give up halfway through.
1. **AI Bug fixes:** I gave each AI the same prompt to clean up bugs/hacks/TODOs/hardcoded values. Details are below. GPT and Claude sonnet were fine. Claude Opus was a mixed bag. Gemini was a complete disaster.
1. **Human Linting:** At this point, all the tests are passing, the code is somewhat organized, and mostly bug free. But it all looks like it was written by a toddler, time to apply my extremely strict linting rules. 
1. **AI Readability improvements:** I had Claude Opus try to make the code easier to read (JSDoc comments, no single character variable names, no abbreviations in variables, grouping logic into related functions, breaking up lines of code, explain complex regex, etc.).
1. **AI color completeness:** Had Claude Opus handle all named colors, and always convert to the shorter character representation, removing a hard-coded solution.
1. **Test improvements:** Throughout this process, as upstream tests were improved or created, they were pulled in, and the AI was instructed to pass those new tests with prompts like, "Run `npm t` and fix all failing tests by modifying files in `src`."


**Full Notes of AI Experiment:**

* Both versions of Claude do fine with small tasks, but given a larger task, will just spin its wheels for over an hour, change no files, then stop running.
* Gemini will get into loops where it skips tasks, then loops back around and tries them again, skips them to move on to others it skipped already, etc... until you stop it. But it will solve some of the tasks prior to this.
* GPT will solve some of the harder problems, but break other tests in the process. In general, GPT is the best at actually getting through a task, but also has the most mediocre code.
* At one point Gemini got 55 failing tests down to 15, then for some reason, reverted back to the previous commit and lost all progress, going back to 55 failing. wtf
* All of the AI's had a weird proclivity to try to create their own testing file, and to generate random JSON files of failing lists. Even when I already provided a command to give them the same JSON, they ended up generating on their own. fuckin' weird.
* At one point, while writing the logic of a minification library, one of the AI's decided to pull in a different minification library (LightningCSS) to try to avoid actually solving the problem in this library, which was pretty funny, and resulted in me adding to every prompt from then on out, for it not to do that again. Here is the prompt I used for most of the test categories, only changing the folder location.
  * **PROMPT:** Get all tests in the `/copiedTests/shorthands` folder to pass by refactoring and updating `/src/index.js`. Use `node analyze.js` to see what tests are still failing. Do not use LightningCSS.
* All of them preferred to just keep adding hundreds of lines of code in the `/src/index.js` file, at no point did any of them even consider breaking some of the code out into other files. I assume this is a result of negative reinforcement. In an established project, I probably wouldn't want the AI unilaterally organizing code into a bunch of new files, so coders have probably given it feedback to just put the code into the existing spot and to change as little as possible. I am now realizing that my prompt did say to refactor/update the `index.js` file, so maybe they all just really took that to heart.
* Some of the AI's would take shortcuts, creating comments like:
  * `// We will handle the rgb conversion later, let's just do a hack for the exact test`
  * Where it just hardcodes a value to get the test to pass instead of writing the actual logic that the library should be doing
  * I accepted this during the initial multi-day process of just trying to get all the tests to pass. This was followed by having the AI's find and fix bugs, remove hacks, etc.
  * **PROMPT:** Look in the `/src` folder at all the files, try to find and fix any bugs, or "TODOs", or incomplete code, or hacks. Solidify the codebase to be a robust and reliable minification library.
* After all tests were passing, I had the GPT-5.4 break the code out into other files and organize the code better.
  * **PROMPT:** The `/src/index.js` contains all logic for the CSS minification library. Refactor this code to retain the same functionality, but better organized. Break the code up into files and folders that would make the most sense for new contributors to know where to look to change the code.
* After that, I had each AI look for bugs and try to fix them with this
  * **PROMPT:** Look in the `/src` folder at all the files, try to find and fix any bugs, or "TODOs", or incomplete code, or hacks. Solidify the codebase to be a robust and reliable minification library.
  * The results of the AI's attempting to fix bugs are listed below, note that AI's that went later had fewer opportunities to find bugs that weren't already fixed by the prior AI's.
  * GPT 5.4 - Fixed 12, found 1 incorrect upstream test, created 3 new tests and 1 useless one.
  * Claude Sonnet - Fixed 5 bugs, removed 5 hacks
  * Claude Opus - Removed 24 hard-coded values that just make tests pass, Broke 2 tests, removed some dead code, incorrectly applied a fix for a test that accidentally pointed out how that test could be better written, removed duplicate logic, moved all color transformation functions to their own `colors.js` (nice), added in new color transformation functions to actually apply real minification, now that the hard coded examples are gone. Added in some more hard coded values for color names to hex, instead of mapping all color names (bad). It claimed the 2 tests it broke were "invalid", then I asked why they are invalid and it said it was wrong and then fixed the code for them to pass again. What a mixed bag.
  * Gemini 3.1 - Wow, this guy is an idiot. Okay, it rewrote 12 test expectations that were correct and already passing to be wrong. It removed valid CSS transformations calling them "invalid", removed transformations that "don't support older browsers". It removed modern CSS features that it claimed were not part of the language. It found and fixed 2 real bugs, at least, it looked like it did, then I looked into it, and no, it was wrong again on both counts. I know that Gemini went last after the other 3 AI's already fixed things, but yeah, it literally got 100% of this wrong. The first time I got to use the "reject all" button.
* ESLint found a lot of sloppy regex. Despite asking 4 AI's to remove dead code, there was still a function that was defined and never used, along with a bunch of defined variables/arguments never used. Some unused imports, and an array of array of strings that was exported but never imported.
* I had Claude Opus add context to all the JSDoc comments, and in one pass it did all of them, no issues.
  * **PROMPT:** In the `/src` folder, fill in any missing descriptions in the JSDoc comment blocks. Add context and intent. Fill out the correct types, and a description for all arguments and returns. Also do a short 1 or 2 sentence summary of the file in the `@file` comment. Run `npm run lint` to validate none were missed.
* I then had Claude Opus attempt a readability refactor. It did okay, but has zero idea where to add a return in a line of code to split it into multiple lines. I blame this on the pervasive virus that is "dog shit prettier, the worst formatting tool in the universe, that puts returns in the dumbest possible places". There has to be so much of that garbage in its training data. Tried with a very detailed second prompt with code examples and it cleaned up some of that, but ultimately, I think I'd have to wade through the slop code line-by-line to clean it up to my standards, and I'm not going to bother with that now.
  * **PROMPT:** Improve the code readability for the files in `/src`. Avoid single character variable names (except for colors like `r` instead of `red` in a function that deals with RGB). Avoid abbreviations in variable and function names, except for words that are more commonly seen abbreviated, such as sRGB, HTML, CSS, etc. Avoid ternaries. If a line of code would more commonly be seen broken into multiple lines, prefer that. Most importantly, only convey one idea per line of code. If this means you need to add additional lines to store data in variables that better convey that line's idea in their name, do so.
  * **PROMPT:**
    > Refactor the code in `/src`. Do not use shorthand for arrow functions. Always break them up to at least 3 lines, including an explicit return if needed.
    >
    > You converted some code from this style
    > ```js
    > foo.bar(x => x.biz.buzz().qux());
    > ```
    > to this:
    > ```js
    > foo.bar(
    >   (x) => x.biz.buzz().qux()
    > );
    > ```
    > prefer this instead:
    > ```js
    > foo.bar((x) => {
    >   return x
    >     .biz
    >     .buzz()
    >     .qux();
    > });
    > ```
    >
    > When you have a complex template literal, convert it either to classic string concatenation, or if there is a repetitive pattern, put the strings/variables into an Array with a join on the repeated pattern. Only use a template literal if it contains new lines and does not use inline variables (${foo}). If you are converting a template literal to string concatenation, ensure that the outcome is still coerced to an identical string.
    >
    > ```js
    > // before
    > const a = `${x}--${y}--${z}`;
    > const b = `translate(${x})`;
    > const c = `
    > foo
    > bar
    > buzz
    > `.trim();
    > const i = 2;
    > const j = `${i}${i}`;
    > ```
    > ```js
    > // after
    > const a = [
    >   x,
    >   y,
    >   z
    > ].join('--');
    > const b = 'translate(' + x  + ')';
    > const c = `
    > foo
    > bar
    > buzz
    > `.trim();
    > const i = 2;
    > const j = [i, i].join('');
    > ```
  * **PROMPT:** Refactor the code in `src`. Find related logic that could be grouped into small functions. Any time there is a complex regex pattern, either pull it out to a well named variable or function, or add detailed comments explaining what the purpose of the regex is. Include JSDoc comments on new functions. Run `npm run lint` to verify linting passes.
  * **PROMPT:** Looking at the files in the src folder, are there any improvements you can think of to better organize the code?
    * This resulted in a 6-point plan that I approved.
  * **PROMPT:** At line 613 of `src/value/minify.css` we list a handful of specific colors to minify. This seems like a naive approach. Instead, all color values should be evaluated consistently and converted to all other compatible representations, including checking if their colors are an exact match for a named color (`red`, `tan`, etc.). Then compare all representations to find the version with the shortest length. Preferring hex where possible.
* I guess this is done now. Only thing left to do is give it a name and release it into the world.


## The name

After the library was complete, I asked Claude Sonnet to generate names for this library, then asked it to pick its own name.

**PROMPT:**

> The logic in this repo was 100% vibe coded and has not been reviewed. It was primarily made as an experiment to find upstream issues and improvements for a CSS Minification correctness auditing library. This vibe coded minifier library is now the only tool with a 100% passing score. Though I don't feel comfortable recommending it to people as it has never been vetted on real code, or validated that the logic solves actual problems, instead of just making the tests pass. I'd like to publish this experiment, but I need a name for this library to communicate that others should not use it in production. Something to convey that the output cannot be fully trusted.
>
> **Criteria:**
>
> * It does not have to convey that it was written entirely by AI, but if that can be assumed from the name, that would be helpful.
> * Bonus points if the name is clever or uses sardonic/dark humor. Even somewhat offensive names would be acceptable if funny, don't hold back.
> * Feel free to include "slop", "clanker", and other AI pejoratives.
> * Most "CSS Minifier" libraries have "CSS" somewhere in the name, or some way of conveying that the library works with CSS and/or minification. This would be helpful, but isn't required, and I'm willing to sacrifice this if the name is funny enough without conveying this.

I already had a list of 10 or so names I had come up with, one of them was "CSSLOP". A few of the ones on my list appeared in the ~50 names Claude suggested, but CSSLOP was not one of them, though `css-slop` was. I combined the lists, and narrowed it down to 14 names that I found acceptable and asked it to sort them from best to worst, and then to pick its own name. CSSLOP was the top of the sorted list.

**PROMPT:**

> Claude, as you wrote a portion of this library, which of these names would you pick for yourself.

```
**CSSLOP.**
The portmanteau does the work without needing context. Anyone reading it in a `package.json` immediately knows what they're dealing with, and there's something fitting about a vibe-coded CSS minifier naming itself after the defining pejorative for AI-generated content.
```

True dat, clanker


## Usage

`npm i --save-dev csslop`

```js
import { minifyCSS } from 'csslop';

const input = 'body { color: blue; color: #FF0000FF; }';
const output = minifyCSS(input);

console.log(output); // 'body{color:red}'
```


## License

This repo intentionally does not have a license. AI generated code is a huge legal gray area and will continue to be until actual lawsuits go before judges. All licenses require that the person offering the code under that license is the copyright owner, and therefore legally able to license the work however they chose. The US copyright office has stated that content generated by AI cannot be copyrighted. A final work must be a human creation to be copyrighted. There is a lot of nuance around how much creative work a human must contribute to the outcome before it can become worthy of copyright. However, regardless of that nuance, in the case of this repo (*and all vibe coded projects*), you cannot license this work, because it cannot be copyrighted. Simply giving a prompt, or series of prompts, and accepting the output without re-writing it in your own words, is absolutely not copyrightable. Anyone telling you otherwise is wrong (or purposefully lying to you to sell you something).

> "Okay, but I just want to know if I'm allowed to use it or fork it?"

Two different cases:

1. **Use:** Use of the library code is not copyrighted, and therefor cannot be licensed, but also, no one can sue you for using it, but also, you have no legal recourse if anything goes wrong as a result of using it. Similar to the "Unlicense" or other "Public Domain" materials.
1. **Forking:**
   * The `copiedTests` folder contains code directly copied from https://github.com/keithamus/css-minify-tests which is MIT Licensed
   * The `src` folder contains code 100% written by AI, and cannot be copyrighted, nor licensed.
   * All other code in this repo was written by me, and uses the MIT License.


## Updating tests

1. All test changes must occur upstream, be written by a human, and be merged in to the `css-minify-tests` repo.
1. After that, delete the `package-lock.json` and `node_modules` folder.
1. Then run `npm i && npm run copy` to download the latest tests and copy them to this repo.
1. `git add -A && git commit -m "Updated tests"`
1. Then run `npm t` to see if any tests fail
1. If they fail, give an AI this prompt:
   * **PROMPT:** Run `npm t` and fix all failing tests by modifying files in `src`.
1. Verify only code in the `src` folder was modified
1. Verify `npm t` passes with a 100% score
1. Run `npm run lint`, if anything fails, have the AI fix it.
1. If the code changes look hacky, or hard coded, tell the AI to fix it
1. `git add -A && git commit -m "Fix newly added tests" && git push`
1. Bump the version number
1. Do a new release
1. Publish the release to npm
