// Tiny safe expression evaluator for tier_routing and stage optional_when.
// Supports: identifier paths (epic.size), strings ('full'), numbers, arrays
// (in, ['x','y']), and operators: ==, !=, in, not in, &&, ||, !, ( ), starts_with,
// ends_with. Whitespace is permitted. Single quotes required for strings.
//
// Intentionally not Turing-complete and not eval-based. If your routing rule
// needs more than this, drop a `runs:` shell guard or write a custom tier
// router.

const TOKEN_PATTERNS = [
	["WS", /^\s+/],
	["LPAREN", /^\(/],
	["RPAREN", /^\)/],
	["LBRACKET", /^\[/],
	["RBRACKET", /^\]/],
	["COMMA", /^,/],
	["AND", /^&&/],
	["OR", /^\|\|/],
	["NOT", /^!(?!=)/],
	["EQ", /^==/],
	["NEQ", /^!=/],
	["NUMBER", /^-?\d+(?:\.\d+)?/],
	["STRING", /^'((?:\\'|[^'])*)'/],
	["KEYWORD", /^(in|not\s+in|starts_with|ends_with)\b/],
	["IDENT", /^[a-zA-Z_][\w.-]*/],
];

function tokenize(input) {
	const tokens = [];
	let rest = input;
	while (rest.length > 0) {
		let matched = false;
		for (const [type, re] of TOKEN_PATTERNS) {
			const m = rest.match(re);
			if (!m) continue;
			if (type !== "WS") {
				tokens.push({ type, value: m[1] !== undefined ? m[1] : m[0] });
			}
			rest = rest.slice(m[0].length);
			matched = true;
			break;
		}
		if (!matched) {
			throw new Error(`Cannot tokenize at: "${rest}" in expression: ${input}`);
		}
	}
	return tokens;
}

function getNested(ctx, path) {
	const parts = path.split(".");
	let cursor = ctx;
	for (const p of parts) {
		if (cursor === null || cursor === undefined) return undefined;
		cursor = cursor[p];
	}
	return cursor;
}

class Parser {
	constructor(tokens) {
		this.tokens = tokens;
		this.pos = 0;
	}
	peek() {
		return this.tokens[this.pos];
	}
	consume(type) {
		const tok = this.tokens[this.pos];
		if (!tok) throw new Error(`Unexpected end of expression, expected ${type}`);
		if (type && tok.type !== type) {
			throw new Error(`Expected ${type}, got ${tok.type} ("${tok.value}")`);
		}
		this.pos++;
		return tok;
	}
	parseOr() {
		let left = this.parseAnd();
		while (this.peek()?.type === "OR") {
			this.consume("OR");
			const right = this.parseAnd();
			left = { kind: "or", left, right };
		}
		return left;
	}
	parseAnd() {
		let left = this.parseNot();
		while (this.peek()?.type === "AND") {
			this.consume("AND");
			const right = this.parseNot();
			left = { kind: "and", left, right };
		}
		return left;
	}
	parseNot() {
		if (this.peek()?.type === "NOT") {
			this.consume("NOT");
			return { kind: "not", expr: this.parseNot() };
		}
		return this.parseCompare();
	}
	parseCompare() {
		const left = this.parsePrimary();
		const next = this.peek();
		if (!next) return left;
		if (next.type === "EQ" || next.type === "NEQ") {
			this.consume(next.type);
			const right = this.parsePrimary();
			return { kind: next.type === "EQ" ? "eq" : "neq", left, right };
		}
		if (next.type === "KEYWORD") {
			this.consume("KEYWORD");
			const right = this.parsePrimary();
			return { kind: next.value.replace(/\s+/, "_"), left, right };
		}
		return left;
	}
	parsePrimary() {
		const tok = this.peek();
		if (!tok) throw new Error("Unexpected end of expression");
		if (tok.type === "LPAREN") {
			this.consume("LPAREN");
			const inner = this.parseOr();
			this.consume("RPAREN");
			return inner;
		}
		if (tok.type === "LBRACKET") {
			this.consume("LBRACKET");
			const items = [];
			if (this.peek()?.type !== "RBRACKET") {
				items.push(this.parsePrimary());
				while (this.peek()?.type === "COMMA") {
					this.consume("COMMA");
					items.push(this.parsePrimary());
				}
			}
			this.consume("RBRACKET");
			return { kind: "array", items };
		}
		if (tok.type === "STRING") {
			this.consume("STRING");
			return { kind: "literal", value: tok.value };
		}
		if (tok.type === "NUMBER") {
			this.consume("NUMBER");
			return { kind: "literal", value: Number(tok.value) };
		}
		if (tok.type === "IDENT") {
			this.consume("IDENT");
			return { kind: "ident", path: tok.value };
		}
		throw new Error(`Unexpected token: ${tok.type} ("${tok.value}")`);
	}
}

function evalNode(node, ctx) {
	switch (node.kind) {
		case "literal":
			return node.value;
		case "ident":
			return getNested(ctx, node.path);
		case "array":
			return node.items.map((item) => evalNode(item, ctx));
		case "or":
			return (
				Boolean(evalNode(node.left, ctx)) || Boolean(evalNode(node.right, ctx))
			);
		case "and":
			return (
				Boolean(evalNode(node.left, ctx)) && Boolean(evalNode(node.right, ctx))
			);
		case "not":
			return !evalNode(node.expr, ctx);
		case "eq":
			return evalNode(node.left, ctx) === evalNode(node.right, ctx);
		case "neq":
			return evalNode(node.left, ctx) !== evalNode(node.right, ctx);
		case "in": {
			const v = evalNode(node.left, ctx);
			const list = evalNode(node.right, ctx);
			return Array.isArray(list) && list.includes(v);
		}
		case "not_in": {
			const v = evalNode(node.left, ctx);
			const list = evalNode(node.right, ctx);
			return !(Array.isArray(list) && list.includes(v));
		}
		case "starts_with": {
			const v = evalNode(node.left, ctx);
			const prefix = evalNode(node.right, ctx);
			return (
				typeof v === "string" &&
				typeof prefix === "string" &&
				v.startsWith(prefix)
			);
		}
		case "ends_with": {
			const v = evalNode(node.left, ctx);
			const suffix = evalNode(node.right, ctx);
			return (
				typeof v === "string" &&
				typeof suffix === "string" &&
				v.endsWith(suffix)
			);
		}
		default:
			throw new Error(`Unknown node kind: ${node.kind}`);
	}
}

export function evaluatePredicate(expression, context) {
	if (!expression) return false;
	const tokens = tokenize(expression);
	const parser = new Parser(tokens);
	const ast = parser.parseOr();
	return Boolean(evalNode(ast, context));
}
