/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

const handlers = require("./handlers");

/**
 * The Evaluator takes a Jexl expression tree as generated by the
 * {@link Parser} and calculates its value within a given context. The
 * collection of transforms, context, and a relative context to be used as the
 * root for relative identifiers, are all specific to an Evaluator instance.
 * When any of these things change, a new instance is required.  However, a
 * single instance can be used to simultaneously evaluate many different
 * expressions, and does not have to be reinstantiated for each.
 * @param {{}} grammar A grammar object against which to evaluate the expression
 *      tree
 * @param {{}} [context] A map of variable keys to their values. This will be
 *      accessed to resolve the value of each non-relative identifier. Any
 *      Promise values will be passed to the expression as their resolved
 *      value.
 * @param {{}|Array<{}|Array>} [relativeContext] A map or array to be accessed
 *      to resolve the value of a relative identifier.
 * @param {function} promise A constructor for the Promise class to be used;
 *      probably either Promise or PromiseSync.
 */
class Evaluator {
  constructor(
    grammar,
    context,
    expression,
    relativeContext,
    promise = Promise
  ) {
    this._grammar = grammar;
    this._context = context || {};
    this._expression = expression;
    this._relContext = relativeContext || this._context;
    this.Promise = promise;
  }

  /**
   * Evaluates an expression tree within the configured context.
   * @param {{}} ast An expression tree object
   * @returns {Promise<*>} resolves with the resulting value of the expression.
   */
  eval(ast) {
    return this.Promise.resolve().then(() => {
      return handlers[ast.type].call(this, ast);
    });
  }

  /**
   * Simultaneously evaluates each expression within an array, and delivers the
   * response as an array with the resulting values at the same indexes as their
   * originating expressions.
   * @param {Array<string>} arr An array of expression strings to be evaluated
   * @returns {Promise<Array<{}>>} resolves with the result array
   */
  evalArray(arr) {
    return this.Promise.all(arr.map((elem) => this.eval(elem)));
  }

  /**
   * Simultaneously evaluates each expression within a map, and delivers the
   * response as a map with the same keys, but with the evaluated result for each
   * as their value.
   * @param {{}} map A map of expression names to expression trees to be
   *      evaluated
   * @returns {Promise<{}>} resolves with the result map.
   */
  evalMap(map) {
    const keys = Object.keys(map);
    const result = {};
    const asts = keys.map((key) => {
      return this.eval(map[key]);
    });
    return this.Promise.all(asts).then((vals) => {
      vals.forEach((val, idx) => {
        result[keys[idx]] = val;
      });
      return result;
    });
  }

  /**
   * Applies a filter expression with relative identifier elements to a subject.
   * The intent is for the subject to be an array of subjects that will be
   * individually used as the relative context against the provided expression
   * tree. Only the elements whose expressions result in a truthy value will be
   * included in the resulting array.
   *
   * If the subject is not an array of values, it will be converted to a single-
   * element array before running the filter.
   * @param {*} subject The value to be filtered usually an array. If this value is
   *      not an array, it will be converted to an array with this value as the
   *      only element.
   * @param {{}} expr The expression tree to run against each subject. If the
   *      tree evaluates to a truthy result, then the value will be included in
   *      the returned array otherwise, it will be eliminated.
   * @returns {Promise<Array>} resolves with an array of values that passed the
   *      expression filter.
   * @private
   */
  _filterRelative(subject, expr) {
    const promises = [];
    if (!Array.isArray(subject)) {
      subject = subject === undefined ? [] : [subject];
    }
    subject.forEach((elem) => {
      const evalInst = new Evaluator(
        this._grammar,
        this._context,
        this._expression,
        elem,
        this.Promise
      );
      promises.push(evalInst.eval(expr));
    });
    return this.Promise.all(promises).then((values) => {
      const results = [];
      values.forEach((value, idx) => {
        if (value) {
          results.push(subject[idx]);
        }
      });
      return results;
    });
  }

  /**
   * Applies a static filter expression to a subject value.  If the filter
   * expression evaluates to boolean true, the subject is returned if false,
   * undefined.
   *
   * For any other resulting value of the expression, this function will attempt
   * to respond with the property at that name or index of the subject.
   * @param {*} subject The value to be filtered.  Usually an Array (for which
   *      the expression would generally resolve to a numeric index) or an
   *      Object (for which the expression would generally resolve to a string
   *      indicating a property name)
   * @param {{}} expr The expression tree to run against the subject
   * @returns {Promise<*>} resolves with the value of the drill-down.
   * @private
   */
  _filterStatic(subject, expr) {
    return this.eval(expr).then((res) => {
      if (subject === undefined || subject === null) {
        return undefined;
      }
      if (typeof res === "boolean") {
        return res ? subject : undefined;
      }
      return subject[res];
    });
  }
}

module.exports = Evaluator;
