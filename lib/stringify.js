function escapeKeyOfExpressionIdentifier(identifier, ...keys) {
  if (keys.length === 0) {
    return identifier;
  }
  const key = keys[0];
  return escapeKeyOfExpressionIdentifier(
    key.match(/^[A-Za-z_]\w*$/)
      ? `${identifier}.${key}`
      : `${identifier}["${key.replace(/"/g, '\\"')}"]`,
    ...keys.slice(1)
  );
}

function stringify(grammar, ast, ancestors = []) {
  if (!ast) {
    return "";
  }

  const recur = (childAst) => stringify(grammar, childAst, [...ancestors, ast]);

  const recurWithBracketsIfRequired = (
    parentElement,
    childAst,
    { isRightHandSide = false } = {}
  ) => {
    const parentPrecedence =
      parentElement && parentElement.type === "binaryOp"
        ? parentElement.precedence
        : 0;

    const childBinaryExpressionElement =
      childAst.type === "BinaryExpression"
        ? grammar.elements[childAst.operator]
        : null;
    const childPrecedence =
      childAst.type === "ConditionalExpression"
        ? 0
        : childBinaryExpressionElement &&
          childBinaryExpressionElement.type === "binaryOp"
        ? childBinaryExpressionElement.precedence
        : Infinity;

    const rhsOfBinaryOpInTernaryConditionWorkaround =
      isRightHandSide &&
      childAst.type === "FunctionCall" &&
      childAst.pool === "transforms" &&
      parentElement &&
      parentElement.type === "binaryOp" &&
      ancestors[ancestors.length - 1] &&
      ancestors[ancestors.length - 1].type === "ConditionalExpression";

    const childExpressionString = recur(childAst);
    if (
      isRightHandSide
        ? parentPrecedence >= childPrecedence ||
          rhsOfBinaryOpInTernaryConditionWorkaround
        : parentPrecedence > childPrecedence
    ) {
      return `(${childExpressionString})`;
    }
    return childExpressionString;
  };

  switch (ast.type) {
    case "Literal":
      if (typeof ast.value === "number" && ast.value.toString().includes("e")) {
        const prefix = ast.value < 0 ? "-" : "";
        return (
          prefix +
          Math.abs(ast.value).toLocaleString("en-US", { useGrouping: false })
        );
      }
      return JSON.stringify(ast.value);
    case "Identifier":
      // TODO: if identifierAst can generate FilterExpressions when required then can we ditch `escapeKeyOfExpressionIdentifier`?
      if (ast.from) {
        return `${recur(ast.from)}${escapeKeyOfExpressionIdentifier(
          "",
          ast.value
        )}`;
      } else {
        return escapeKeyOfExpressionIdentifier(ast.value);
      }
    case "UnaryExpression": {
      let right = recur(ast.right);
      if (
        ast.right.type === "BinaryExpression" ||
        ast.right.type === "ConditionalExpression"
      ) {
        right = `(${right})`;
      }
      return `${ast.operator}${right}`;
    }
    case "BinaryExpression": {
      const left = recurWithBracketsIfRequired(
        grammar.elements[ast.operator],
        ast.left
      );
      const right = recurWithBracketsIfRequired(
        grammar.elements[ast.operator],
        ast.right,
        { isRightHandSide: true }
      );
      return `${left} ${ast.operator} ${right}`;
    }
    case "ConditionalExpression": {
      const test = recurWithBracketsIfRequired(null, ast.test);
      const consequent = recurWithBracketsIfRequired(null, ast.consequent);
      const alternate = recurWithBracketsIfRequired(null, ast.alternate);
      return `${test} ? ${consequent} : ${alternate}`;
    }
    case "ArrayLiteral":
      return `[${ast.value.map(recur).join(", ")}]`;
    case "ObjectLiteral":
      return `{ ${Object.entries(ast.value)
        .map(([key, value]) => `"${key}": ${recur(value)}`)
        .join(", ")} }`;
    case "FilterExpression":
      return `${recur(ast.subject)}[${ast.relative ? "." : ""}${recur(
        ast.expr
      )}]`;
    case "FunctionCall":
      switch (ast.pool) {
        case "functions":
          return `${ast.name}(${ast.args.map(recur).join(", ")})`;
        case "transforms":
          // Note that transforms always have at least one argument
          // i.e. `a | b` is `b` with one argument of `a`
          return `${recur(ast.args[0])} | ${ast.name}${
            ast.args.length > 1
              ? `(${ast.args.slice(1).map(recur).join(", ")})`
              : ""
          }`;
      }
  }
}

module.exports = { stringify };
