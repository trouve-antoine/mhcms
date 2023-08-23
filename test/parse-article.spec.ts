import { parseCodeBlockParagraph, postProcessParagraphLines } from "../src";
import { expect } from "chai";


describe("Parse code blocks", () => {
    it("Parse simple code block", () => {
        const block = parseCodeBlockParagraph([ "```", "toto", "```" ]);
        expect(block).to.not.haveOwnProperty("language");
        expect(block).to.not.haveOwnProperty("options");
        expect(block.content).to.equal("toto");
    });
    it("Parse code block with language", () => {
        const block = parseCodeBlockParagraph([ "```cool", "toto", "```" ]);
        expect(block.language).to.equal("cool");
    });
    it("Parse code block with options", () => {
        const block = parseCodeBlockParagraph([ "```{cool name=you large !small}", "toto", "```" ]);
        expect(block.content).to.equal("toto");
        expect(block.language).to.equal("cool");
        expect(block.options.name).to.equal("you");
        expect(block.options.large).to.equal(true);
        expect(block.options.small).to.equal(false);
    });
    it("Parse other code block with options", () => {
        const block = parseCodeBlockParagraph(["```{r name=/some/path hasOutput !canExecute}", "toto", "```"]);
        expect(block.content).to.equal("toto");
        expect(block.language).to.equal("r");
        expect(block.options.name).to.equal("/some/path");
        expect(block.options.hasOutput).to.equal(true);
        expect(block.options.canExecute).to.equal(false);
    });
});

describe("Parse paragraph", () => {
    it("Parse simple paragraph", () => {
        const p = postProcessParagraphLines([ "toto" ]);
        if (p.type !== "text") {
            return expect.fail("type should be text");
        }
        expect(p.content).to.equal("toto");
    })
    it("Parse code block", () => {
        const p = postProcessParagraphLines([ "```{r name=/some/path hasOutput !canExecute}", "toto", "```" ]);
        if (p.type !== "code-block") {
            return expect.fail("type should be code");
        }
        expect(p.language).to.equal("r");
        expect(p.options.name).to.equal("/some/path");
        expect(p.options.hasOutput).to.equal(true);
        expect(p.options.canExecute).to.equal(false);
        expect(p.content).to.equal("toto");
    })
    it("Parse JSON object block", () => {
        const p = postProcessParagraphLines([ "```{json name=/some/path hasOutput !canExecute @parse}", "{ \"a\": 1 }", "```" ]);
        if (p.type !== "object") {
            return expect.fail("type should be object");
        }
        expect(p.options.name).to.equal("/some/path");
        expect(p.options.hasOutput).to.equal(true);
        expect(p.options.canExecute).to.equal(false);
        expect(p.options).not.hasOwnProperty("@parse");
        expect(p.content).to.deep.equal({ a: 1 });
    })
    it("Parse YAML object block", () => {
        const p = postProcessParagraphLines([
            "```{yaml name=/some/path hasOutput !canExecute @parse}",
            "toto:",
            "  tata:",
            "    1",
            "```"
        ]);
        if (p.type !== "object") {
            return expect.fail("type should be object");
        }
        expect(p.options.name).to.equal("/some/path");
        expect(p.options.hasOutput).to.equal(true);
        expect(p.options.canExecute).to.equal(false);
        expect(p.options).not.hasOwnProperty("@parse");
        expect(p.content).to.deep.equal({ toto: { tata: 1 } });
    })
    it("Parse empty paragraph", () => {
        const p = postProcessParagraphLines([ "" ]);
        expect(p.type).to.equal("empty");
    })
    it("Parse unknown object language", () => {
        const p = postProcessParagraphLines(["```{popo @parse}", "{ \"a\": 1 }", "```"]);
        if (p.type !== "code-block") {
            return expect.fail("type should be object");
        }
        expect(p.options).hasOwnProperty("@parse");
        expect(p.content).to.equal("{ \"a\": 1 }");
    })
});