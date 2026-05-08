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
];
