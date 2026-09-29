# 第七轮 · 繁译简 / 英译中 体检简报（e2s 包：全部 297 道英译中题）

项目根目录：`C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏`

对象：母本 `data\library\library.data.js` 里带 **「英译中」** 标签的题（297 道，原文来自 yesnogame.net/en、boop-yyt/situation_puzzle、Jed's List）。
`tools\check7_pair\e2s_NN.txt` 每包 34 道（末包不足），给出「英文原文 → 现库中文」全文对照。
**只读不改任何数据文件**，只交问题清单。

---

## 本轮的特有情况（先读）
- 英文原文本身常带**拼写/语法错误**（站方是俄语/西语母语者英文，如 `farther's fortune`、`he island`、`opportumity`、`Suppose to`）。**照原意正确译出中文不算错**；把英文的错**照搬**进中文（如把明显笔误当成人物关系）才算问题。**不要**报「原文有拼写错误」。
- 原文里以 `Clue:` / `Hint:` / `There are several possible answers:` / `or` 分列的**多条并列解答**，译文保留主线、把并列解压缩为「或者…」是允许的；只有**整条解被丢掉且它是唯一解释**时才报 `omission`。
- 原文里出现的**站内/作者脚手架**（`Answer by: xxx`、`submitted by`、`#tag`、`More puzzles`、评分、投票、URL、`This is also based on an actual accident` 之外的站方推广语）被删是**正确**的，不要报。而承担信息量的句子（如「这是真实事故改编」）译出或省略都可接受，**不算** omission。
- 英文**双关/文字游戏**（如 `opens an envelope and dyes`、`the last taxi`）在中文里必须另找落点或加括注说明；直接把双关压成平白叙述、让玩家完全看不出机关，报 `mistranslate`（双关未落地）。
- 题目里的人名/地名：同一题内**同一实体两种译法**（如「奥斯卡」又译「奥斯汀」）报 `mistranslate`；跨题译法不一致**不要**报。
- 短题干被扩写成两三句中文（补足语境）属正常意译，只有**新增情节/新人物/新道具/新动机**才报 `addition`。

## 只报这 6 类 kind
- `mistranslate`：意思译错（否定反了、因果颠倒、人物关系错、关键名词张冠李戴、数字/时间/单位/时态错、双关未落地）。
- `omission`：原文属于本题的内容在译文里整句/整段缺失（含起决定作用的那一句、`Clue:` 里唯一的关键提示）。
- `untranslated`：该译成中文的地方留着整句/整段英文没译（**必要保留**的专名、`elf` 这类题眼词、加了中文说明的双关原词不算）。
- `cut`：译文在半截处结束，而原文同处还有正文。
- `addition`：译文多出原文没有的情节/人物/道具/动机（措辞润色、为解释双关加的括注不算）。
- `junk`：汤面/汤底/标题里夹带与本谜题无关的内容（站方公告、署名、评分、URL、导流话术、装饰线残留、乱码、控制字符、明显的其它题目串台内容）。

## 不许当错误报的
1. 汤底不与汤面共用措辞是本类谜题的正常写法。
2. 机翻腔、语句生硬、黑暗猎奇内容、道德不适内容 —— 都不算问题。
3. 汤底多解「或者…」式并列 —— 只要中文里有一条能解释汤面就合格。
4. 本题库没有关键词表，不要因「没有关键词提示」报问题。
5. 标题短、带引号、带系列前缀（如 `Jed 1.83`）正常。

---

## 读取纪律（本文件最重要）
每个包都要**从头读到尾**：必须用 `Read` 的 `offset`/`limit` 分页直到文件末尾，**严禁抽样、严禁读一半就交卷**。

## 输出
- 写到 `tools\check7_verdicts\e2s_NN.jsonl`（与包同名，如 `e2s_01.jsonl`），目录已存在。
- 每个问题一行 JSON：
  `{"id":"lib_xxxx","kind":"…","field":"surface|truth|title|all","note":"≤40字中文证据","quote":"原文或译文摘录≤60字"}`
- 整批无问题也要写一行 `{"id":"NONE","kind":"none","field":"all","note":"整批无问题","quote":""}`
- **最后一行必须**是覆盖回执：`{"id":"COVERAGE","kind":"meta","field":"all","note":"已读X题/共Y题","quote":"最后一个id"}`，X 必须等于该包实际题数。
- 一行一个 JSON，不要数组、注释、markdown 代码块。
- 结束用一句话汇报：读了多少题、报了多少条、各类多少。
