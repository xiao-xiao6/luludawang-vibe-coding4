# -*- coding: utf-8 -*-
import io, json, re
src = io.open(r'data\library\library.data.js', encoding='utf-8').read()
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
end = src.find('\nvar SOUP_LIB_CATS', i)
data = json.loads(src[i:end].rsplit(']', 1)[0] + ']')
pats = {
 'span': re.compile(r'<span|</span|style="color'),
 'triple_q': re.compile("'''"),
 'gamehelp': re.compile(r'剩余提问次数|剩余回答次数|玩家答案|bingo|json\{'),
 'md_table': re.compile(r'\|\s*字段\s*\|'),
 'hr': re.compile(r'\n\s*-{3,}\s*\n'),
 'quote_mark': re.compile(r'\n>\s?'),
 'zwsp': re.compile(u'[\u200b\u200c\u200d\ufeff]'),
 'template': re.compile(r'题目标题|谜题描述|答案解释'),
 'mathbb': re.compile(r'\\mathbb'),
}
for name, p in sorted(pats.items()):
    hits = [e['id'] for e in data if p.search((e.get('surface','') or '') + '|' + (e.get('truth','') or ''))]
    print(name, len(hits), hits[:14])
