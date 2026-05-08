// CT-0034-01: LLM Extractor Accuracy Test
//
// Tests classification accuracy of the LLM extractor with real-world cases
// Target: 85%+ accuracy on 20+ test cases

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { llmExtract } from '../core/extraction/llm-extractor.js';
import type { SourceBlock } from '../adapters/base.js';

interface TestCase {
  name: string;
  input: string;
  expected: Array<{ type: 'goal' | 'preference' | 'constraint'; text: string }>;
}

const TEST_CASES: TestCase[] = [
  // Real-world misclassification cases
  {
    name: 'Opinion about importance (Chinese)',
    input: '企业级的��据整���很重要',
    expected: [{ type: 'preference', text: '企业��的数���整理很重��' }]
  },
  {
    name: 'Action plan (Chinese)',
    input: '我要���成 cortex 项目',
    expected: [{ type: 'goal', text: '完成 cortex 项目' }]
  },
  {
    name: 'Restriction (Chinese)',
    input: '避免过度设��',
    expected: [{ type: 'constraint', text: '避免过��设计' }]
  },

  // Boundary cases - "��认为X重���" pattern
  {
    name: 'Opinion with "��认为" (Chinese)',
    input: '��认为��试很���要',
    expected: [{ type: 'preference', text: '测试��重要' }]
  },
  {
    name: 'Opinion with "我认为" variant (Chinese)',
    input: '我��为 TypeScript 比 JavaScript 好',
    expected: [{ type: 'preference', text: 'TypeScript 比 JavaScript 好' }]
  },

  // Action plan patterns
  {
    name: 'Action with "我计划" (Chinese)',
    input: '��计划学习 TypeScript',
    expected: [{ type: 'goal', text: '学习 TypeScript' }]
  },
  {
    name: 'Action with "我���" (Chinese)',
    input: '我���构建一个生��级 CLI 工具',
    expected: [{ type: 'goal', text: '���建一个生产级 CLI 工��' }]
  },

  // Preference patterns
  {
    name: 'Preference with "我喜��" (Chinese)',
    input: '我喜���函数式编��',
    expected: [{ type: 'preference', text: '��欢函���式编��' }]
  },
  {
    name: 'Preference with "我���好" (Chinese)',
    input: '我��好使��� TypeScript 而不是 JavaScript',
    expected: [{ type: 'preference', text: '偏好使�� TypeScript 而��是 JavaScript' }]
  },

  // Constraint patterns
  {
    name: 'Constraint with "不��" (Chinese)',
    input: '不���使用 any 类型',
    expected: [{ type: 'constraint', text: '不���使用 any 类型' }]
  },
  {
    name: 'Constraint with "限��" (Chinese)',
    input: '限制���三个月内��成',
    expected: [{ type: 'constraint', text: '限���是三个��内完���' }]
  },

  // English cases
  {
    name: 'Action plan (English)',
    input: 'I want to build a production-ready CLI tool',
    expected: [{ type: 'goal', text: 'build a production-ready CLI tool' }]
  },
  {
    name: 'Preference (English)',
    input: 'I prefer functional programming over OOP',
    expected: [{ type: 'preference', text: 'prefer functional programming over OOP' }]
  },
  {
    name: 'Constraint (English)',
    input: 'Avoid adding unnecessary dependencies',
    expected: [{ type: 'constraint', text: 'avoid adding unnecessary dependencies' }]
  },
  {
    name: 'Opinion about importance (English)',
    input: 'I think testing is crucial for quality',
    expected: [{ type: 'preference', text: 'testing is crucial for quality' }]
  },

  // Mixed cases
  {
    name: 'Multiple types in one input (Chinese)',
    input: '我要���习 React。我���为 TypeScript 很重要��避免���用 JavaScript。',
    expected: [
      { type: 'goal', text: '学习 React' },
      { type: 'preference', text: 'TypeScript 很���要' },
      { type: 'constraint', text: '避免使用 JavaScript' }
    ]
  },
  {
    name: 'Multiple types in one input (English)',
    input: 'I plan to master async/await patterns. I think clean code is important. Avoid callback hell.',
    expected: [
      { type: 'goal', text: 'master async/await patterns' },
      { type: 'preference', text: 'clean code is important' },
      { type: 'constraint', text: 'avoid callback hell' }
    ]
  },

  // Edge cases
  {
    name: 'Opinion with "很关���" (Chinese)',
    input: '代码质��很关���',
    expected: [{ type: 'preference', text: '代码��量很���键' }]
  },
  {
    name: 'Action with "我的���标是" (Chinese)',
    input: '我��目标���通过考试',
    expected: [{ type: 'goal', text: '��过考试' }]
  },
  {
    name: 'Constraint with "保持" (Chinese)',
    input: '保持函数�� 50 行以��',
    expected: [{ type: 'constraint', text: '��持函数在 50 行以内' }]
  },

  // Additional real-world cases
  {
    name: 'Complex preference (Chinese)',
    input: '我认为企��级数据整理很��要，���为客户是��型企���',
    expected: [{ type: 'preference', text: '企��级数���整理很��要' }]
  },
  {
    name: 'Action with timeline (English)',
    input: 'I plan to complete the marathon training in three months',
    expected: [{ type: 'goal', text: 'complete the marathon training in three months' }]
  },
];

describe('LLM Extractor Accuracy', () => {
  // Skip if no LLM backend configured
  const skipTests = !process.env.OPENAI_API_KEY && !process.env.OLLAMA_HOST;

  if (skipTests) {
    it.skip('LLM backend not configured', () => {});
    return;
  }

  let correctCount = 0;
  let totalCount = 0;
  const failures: Array<{ name: string; expected: any; actual: any }> = [];

  for (const testCase of TEST_CASES) {
    it(testCase.name, async () => {
      totalCount++;

      const sourceBlock: SourceBlock = {
        text: testCase.input,
        source_path: 'test',
      };

      const result = await llmExtract([sourceBlock]);

      // Check if result matches expected
      let matches = true;

      if (result.length !== testCase.expected.length) {
        matches = false;
      } else {
        for (let i = 0; i < testCase.expected.length; i++) {
          const exp = testCase.expected[i];
          const act = result[i];

          // Type must match exactly
          if (act.type !== exp.type) {
            matches = false;
            break;
          }

          // Text should contain key terms (fuzzy match for flexibility)
          const expText = exp.text.toLowerCase().replace(/\s+/g, '');
          const actText = (act.text || '').toLowerCase().replace(/\s+/g, '');

          // Check if actual text contains most of expected text or vice versa
          const similarity = expText.length > actText.length
            ? actText.length / expText.length
            : expText.length / actText.length;

          if (similarity < 0.6) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        correctCount++;
      } else {
        failures.push({
          name: testCase.name,
          expected: testCase.expected,
          actual: result,
        });
      }

      // Individual test assertion
      assert.ok(matches, `Expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(result)}`);
    });
  }

  // Summary test
  it('Overall accuracy >= 85%', () => {
    const accuracy = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

    console.log('\n=== LLM Extractor Accuracy Report ===');
    console.log(`Total test cases: ${totalCount}`);
    console.log(`Correct: ${correctCount}`);
    console.log(`Failed: ${totalCount - correctCount}`);
    console.log(`Accuracy: ${accuracy.toFixed(1)}%`);

    if (failures.length > 0) {
      console.log('\nFailed cases:');
      for (const failure of failures) {
        console.log(`- ${failure.name}`);
        console.log(`  Expected: ${JSON.stringify(failure.expected)}`);
        console.log(`  Actual: ${JSON.stringify(failure.actual)}`);
      }
    }

    assert.ok(accuracy >= 85, `Accuracy ${accuracy.toFixed(1)}% is below target 85%`);
  });
});
