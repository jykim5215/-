// LLM-as-judge: 문체 일관성·리드 품질·중립성 등 정성 항목 채점 (rule-based 검사기와 별개)
const { runJson } = require('../main/claude');

async function judgeText({ apiKey, output, styleReference = '' }) {
  const user = [
    styleReference ? `# 참조 스타일 예시\n${styleReference}\n` : '',
    '# 채점 대상\n' + output,
  ].join('\n');
  const { data, modelVersion } = await runJson({
    apiKey,
    promptName: 'judge_style',
    user,
    maxTokens: 2000,
  });
  return { scores: data, modelVersion };
}

module.exports = { judgeText };
