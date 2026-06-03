/**
 * ax-autobindgen type declarations
 */

export interface AutobindgenRule {
  select?: string;
  match?: string;
  value?: any;
  as: "ctx" | "click" | "edit" | "view" | "nav" | "ignore";
  name?: string;
  nameFrom?: string;
}

export interface AutobindgenConfig {
  rules?: AutobindgenRule[];
  builtins?: boolean;
  prefix?: string;
}

export interface AxAutobindgen {
  configure(config: AutobindgenConfig): void;
  addRule(rule: AutobindgenRule): void;
  addMatcher(name: string, fn: (el: Element, rule: AutobindgenRule) => boolean): void;
  bind(root?: Element): void;
  unbind(root?: Element): void;
  BUILTIN_RULES: AutobindgenRule[];
}

declare const axAutobindgen: AxAutobindgen;
export default axAutobindgen;
