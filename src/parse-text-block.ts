const BUILTIN_COMMANDS = {
    "year": args => {
        return (new Date()).getFullYear().toString();
    }
}

export function parseTextBlock(
    txt: string,
    commands: { [cmd: string]: (args: string[]) => string } = {},
    tagWhiteList: string[] = [
        "kbd", "abbr", "b", "bdi", "bdo", "br", "code", "data", "time", "dfn", "em", "ti", "mark",
        "q", "rp", "rt", "rtc", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup",
        "u", "var", "wbr", "del", "ins"
    ]
) {
    commands = { ...BUILTIN_COMMANDS, ...commands };

    /** Replace the [!cmd arg arg] */
    let transformed = txt.replaceAll(/\[\!(\w[\w-\s]+)\]/g, s => {
        const ss = s.slice(2, -1).split(/\s+/);
        if (ss.length === 0) {
            console.warn("Empty command", s)
            return s;
        }
        const cmd = ss[0];
        const args = ss.slice(1);
        if (!(cmd in commands)) {
            console.warn("Unknown command", cmd, "in", s);
            return s;
        }
        return commands[cmd](args);
    })

    /** Replace the [html-element content] */
    transformed = transformed.replaceAll(/[^!]\[(\w[\w-\s]+)\][^(]/g, s => {
        const ss = s.slice(1, -1).split(/\s+/, 1);
        if (ss.length === 0) {
            console.warn("Empty HTML command", s)
            return s;
        }
        const tagName = ss[0];
        if (!tagWhiteList.includes(tagName)) {
            console.warn("Non-whitelisted HTML tag", tagName, "in", s);
            return s;
        }
        const content = s.slice(2 + tagName.length + 1, -1);

        return `<${tagName}>${content}</${tagName}>`
    })

    return transformed;
}