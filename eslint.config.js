import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.js"],
        languageOptions: {
            sourceType: "module",
            ecmaVersion: "latest",
        },
        rules: {
            "no-var": "error",
            "prefer-const": "error",
            "no-unused-vars": "off",
            "no-undef": "off",
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: {
            sourceType: "module",
            ecmaVersion: "latest",
            globals: {
                document: "readonly",
                window: "readonly",
                CustomEvent: "readonly",
                HTMLElement: "readonly",
                HTMLInputElement: "readonly",
                HTMLTextAreaElement: "readonly",
                HTMLSelectElement: "readonly",
                HTMLAnchorElement: "readonly",
                describe: "readonly",
                test: "readonly",
                expect: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
            },
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "off",
            "no-empty": "off",
        },
    },
];
