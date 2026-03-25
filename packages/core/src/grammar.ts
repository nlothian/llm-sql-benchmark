import type { SchemaTable } from './types';

const ROOT_WITH_OK = `root ::= ctequery | okstring

okstring ::= "OK"`;

const ROOT_SQL_ONLY = `root ::= ctequery`;

const SQL_GRAMMAR = `ctequery ::= withclause query | query

withclause ::= "WITH " ctedef (", " ctedef)*

ctedef ::= identifier " AS (" query ")"

query ::= "SELECT " distinctclause selectlist " FROM " fromclause whereclause groupclause orderclause limitclause

distinctclause ::= "DISTINCT " | ""

selectlist ::= selectexpr (", " selectexpr)*

selectexpr ::= expr " AS " alias | expr

alias ::= quotedname | identifier

expr ::= addexpr

addexpr ::= mulexpr ((" + " | " - ") mulexpr)*

mulexpr ::= unaryexpr ((" * " | " / ") unaryexpr)*

unaryexpr ::= atomexpr | "-" atomexpr

atomexpr ::= funccall | columnref | literal | "(" expr ")" | countstar | windowexpr | casexpr

funccall ::= aggfunc "(" distinctarg expr ")" | "ROUND(" expr ", " number ")" | "NULLIF(" expr ", " literal ")" | "COALESCE(" expr ", " expr ")"

countstar ::= "COUNT(*)"

distinctarg ::= "DISTINCT " | ""

aggfunc ::= "SUM" | "COUNT" | "AVG" | "MIN" | "MAX"

windowexpr ::= funccall " OVER (" partitionclause orderclause ")" | funccall " OVER ()" | windowfunc "(" expr ")" " OVER (" partitionclause orderclause ")"

windowfunc ::= "ROW_NUMBER" | "RANK" | "DENSE_RANK" | "LAG" | "LEAD"

partitionclause ::= "PARTITION BY " exprlist | ""

casexpr ::= "CASE " expr whenlist caseelse " END" | "CASE " whenlist caseelse " END"

whenlist ::= whenitem whenitem*

whenitem ::= " WHEN " expr " THEN " expr

caseelse ::= " ELSE " expr | ""

fromclause ::= tableitem (" JOIN " tableitem " ON " expr " = " expr)*

tableitem ::= tablename " " identifier | tablename | identifier

whereclause ::= " WHERE " condition | ""

condition ::= compareexpr (" AND " compareexpr)* | compareexpr (" OR " compareexpr)*

compareexpr ::= expr " " compareop " " expr | "(" condition ")"

compareop ::= "=" | "!=" | "<>" | "<" | ">" | "<=" | ">="

groupclause ::= " GROUP BY " exprlist | ""

orderclause ::= " ORDER BY " orderitem (", " orderitem)* | ""

orderitem ::= expr | expr " ASC" | expr " DESC"

limitclause ::= " LIMIT " number | ""

exprlist ::= expr (", " expr)*

literal ::= sqstring | number | negliteral

negliteral ::= "-" number

number ::= [0-9] [0-9]* ("." [0-9]+)?

sqstring ::= "'" sqchars "'"

sqchars ::= sqchar*

sqchar ::= [^']

identifier ::= [a-zA-Z_] [a-zA-Z0-9_]*

quotedname ::= "\\"" qnchars "\\""

qnchars ::= qnchar+

qnchar ::= [a-zA-Z0-9_ ] | "-"`;

function escapeGbnf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quotedId(name: string): string {
  return '"' + '\\"' + escapeGbnf(name) + '\\"' + '"';
}

function buildTableRule(schema: SchemaTable): string {
  const tables = Object.keys(schema).sort();
  const values = tables.map(t => quotedId(t)).join(' | ');
  return `tablename ::= ${values}`;
}

function buildColumnRefRule(schema: SchemaTable): string {
  const qualifiedRefs: string[] = [];
  const bareRefs = new Set<string>();

  for (const [table, cols] of Object.entries(schema)) {
    for (const col of cols) {
      qualifiedRefs.push(`${quotedId(table)} "." ${quotedId(col.col)}`);
      bareRefs.add(quotedId(col.col));
    }
  }

  const bareRefList = [...bareRefs];
  const aliasDot = 'identifier "." ' + `(${bareRefList.join(' | ')})`;
  const allRefs = [...qualifiedRefs, aliasDot, ...bareRefList];
  return `columnref ::= ${allRefs.join(' | ')}`;
}

export function buildGrammar(schema: SchemaTable, options?: { allowOk?: boolean }): string {
  const rootSection = (options?.allowOk !== false) ? ROOT_WITH_OK : ROOT_SQL_ONLY;
  const parts = [
    rootSection,
    SQL_GRAMMAR.trim(),
    buildTableRule(schema),
    buildColumnRefRule(schema),
  ];
  return parts.join('\n\n') + '\n';
}
