export function parseTextBlock(
    txt: string,
    commands: { [cmd: string]: (args: string[]) => string } = {
        "year": args => {
            return (new Date()).getFullYear().toString();
        }
    }
) {
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
    transformed = transformed.replaceAll(/\[(\w[\w-\s]+)\]/g, s => {
        const ss = s.slice(1, -1).split(/\s+/, 1);
        if (ss.length === 0) {
            console.warn("Empty HTML command", s)
            return s;
        }
        const tagName = ss[0];
        const content = s.slice(2 + tagName.length + 1, -1);

        return `<${tagName}>${content}</${tagName}>`
    })

    return transformed;
}