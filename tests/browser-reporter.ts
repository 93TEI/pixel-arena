import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

export default class BrowserReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    console.log(`${result.status.toUpperCase()} ${test.title} (${result.duration}ms)`);
    for (const error of result.errors) console.log(error.message);
  }
  onEnd(result: FullResult) { console.log(`Browser acceptance: ${result.status}`); }
}
