import { makeStableId } from './normalize';
import type { KnowledgeGraphData } from '../types';

function node(
  label: string,
  kind: 'concept' | 'term' | 'process' | 'book' | 'topic',
  category: string,
  summary: string,
  detail: string,
  aliases: string[] = [],
  sources: string[] = ['demo'],
  score = 1,
) {
  return {
    id: makeStableId('node', label),
    label,
    kind,
    category,
    summary,
    detail,
    aliases,
    sources,
    score,
  };
}

function edge(
  source: string,
  target: string,
  kind: 'is-a' | 'related-to' | 'contrast-with' | 'part-of' | 'depends-on' | 'mentions' | 'same-domain',
  label: string,
  weight: number,
  sources: string[] = ['demo'],
) {
  return {
    id: makeStableId('edge', `${source}:${kind}:${target}:${label}`),
    source,
    target,
    kind,
    label,
    weight,
    sources,
  };
}

const englishRoot = node(
  'Lexical semantics',
  'topic',
  'English',
  '词汇语义学帮助我们理解单词之间为什么相关，以及这些关系如何影响记忆与表达。',
  '它把单词放在关系网络里看：同义、反义、上下位、搭配、词根与词缀都会形成稳定的记忆通道。',
  ['semantics'],
);

const synonym = node(
  'Synonym',
  'term',
  'English',
  '同义词表示意义接近，但语气、语域和搭配常常不同。',
  '例如 big 和 large 往往互为同义，但在固定搭配中的适用性并不完全相同。',
  ['同义词'],
);

const antonym = node(
  'Antonym',
  'term',
  'English',
  '反义词通过对照帮助记忆，并强化概念边界。',
  '例如 hot / cold、increase / decrease。对照关系适合做间隔复习。',
  ['反义词'],
);

const collocation = node(
  'Collocation',
  'concept',
  'English',
  '搭配是单词在真实语境中的稳定共现模式。',
  '理解搭配比孤立背单词更接近真实语言使用，也更适合做图谱关系。',
  ['搭配'],
);

const etymology = node(
  'Etymology',
  'concept',
  'English',
  '词源把词汇拆回历史路径，帮助理解形态与意义演变。',
  '词源适合连接词根、前缀、后缀和历史借词路径。',
  ['词源'],
);

const revolution = node(
  'Industrial Revolution',
  'topic',
  'History',
  '工业革命改变了能源、生产方式、城市结构和劳动组织。',
  '它可以和蒸汽机、工厂制度、资本积累、交通革命等知识点形成强连接。',
  ['工厂制度变革'],
);

const steamEngine = node(
  'Steam engine',
  'concept',
  'History',
  '蒸汽机是工业革命的关键技术节点。',
  '它把热能转化为机械能，推动了矿业、制造业和交通运输的发展。',
  ['蒸汽机'],
);

const diagnosis = node(
  'Diagnosis',
  'process',
  'Medicine',
  '诊断是从症状、体征、检查结果推断疾病的过程。',
  '图谱中它通常连接症状、病原体、检查方法和鉴别诊断。',
  ['诊断'],
);

const inflammation = node(
  'Inflammation',
  'concept',
  'Medicine',
  '炎症是机体对损伤、感染或刺激的防御性反应。',
  '它和发热、红肿、疼痛、白细胞变化等概念紧密相连。',
  ['炎症'],
);

const pathogen = node(
  'Pathogen',
  'concept',
  'Medicine',
  '病原体是能引发疾病的微生物或其他因子。',
  '细菌、病毒、真菌和寄生虫都可以成为病原体。',
  ['病原体'],
);

const algorithm = node(
  'Algorithm',
  'concept',
  'Computer Science',
  '算法描述了解决问题的步骤序列。',
  '时间复杂度、空间复杂度和正确性证明都是图谱中常见的邻近节点。',
  ['算法'],
);

const graphNode = node(
  'Graph',
  'concept',
  'Computer Science',
  '图结构用节点和边表达关系。',
  '知识图谱本身就可以看作一种带语义的图。',
  ['图'],
);

const recursion = node(
  'Recursion',
  'process',
  'Computer Science',
  '递归是函数直接或间接调用自身的思考方式。',
  '它和栈、边界条件、分治思想存在强关联。',
  ['递归'],
);

const abstraction = node(
  'Abstraction',
  'concept',
  'Computer Science',
  '抽象把复杂对象提炼成可复用的核心结构。',
  '抽象与接口、模块、分层设计、建模非常接近。',
  ['抽象'],
);

export const demoGraph: KnowledgeGraphData = {
  nodes: [
    englishRoot,
    synonym,
    antonym,
    collocation,
    etymology,
    revolution,
    steamEngine,
    diagnosis,
    inflammation,
    pathogen,
    algorithm,
    graphNode,
    recursion,
    abstraction,
  ],
  edges: [
    edge(englishRoot.id, synonym.id, 'related-to', 'contains', 0.9),
    edge(englishRoot.id, antonym.id, 'related-to', 'contains', 0.9),
    edge(englishRoot.id, collocation.id, 'related-to', 'contains', 0.9),
    edge(englishRoot.id, etymology.id, 'related-to', 'contains', 0.9),
    edge(synonym.id, antonym.id, 'contrast-with', 'opposes', 0.65),
    edge(synonym.id, collocation.id, 'depends-on', 'usage context', 0.45),
    edge(etymology.id, synonym.id, 'related-to', 'explains meaning', 0.5),
    edge(revolution.id, steamEngine.id, 'depends-on', 'driven by', 0.9),
    edge(steamEngine.id, algorithm.id, 'contrast-with', 'different domain', 0.15),
    edge(diagnosis.id, inflammation.id, 'related-to', 'often evaluates', 0.88),
    edge(diagnosis.id, pathogen.id, 'related-to', 'often seeks cause', 0.78),
    edge(inflammation.id, pathogen.id, 'depends-on', 'may be triggered by', 0.66),
    edge(algorithm.id, graphNode.id, 'part-of', 'implemented on', 0.72),
    edge(algorithm.id, recursion.id, 'depends-on', 'may use', 0.68),
    edge(recursion.id, abstraction.id, 'depends-on', 'requires', 0.82),
    edge(graphNode.id, abstraction.id, 'related-to', 'shares structure thinking', 0.74),
  ],
  documents: [
    {
      id: 'demo-doc-english',
      title: 'Oxford-style vocabulary notes',
      type: 'demo',
      origin: 'demo',
      importedAt: new Date().toISOString(),
      notes: '用于演示词汇语义图谱与关联关系。',
    },
    {
      id: 'demo-doc-history',
      title: 'History chapter sketch',
      type: 'demo',
      origin: 'demo',
      importedAt: new Date().toISOString(),
      notes: '用于演示同主题知识融合。',
    },
    {
      id: 'demo-doc-science',
      title: 'Science and engineering notes',
      type: 'demo',
      origin: 'demo',
      importedAt: new Date().toISOString(),
      notes: '用于演示跨学科知识连接。',
    },
  ],
};
