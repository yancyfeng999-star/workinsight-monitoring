import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyApp, classifyDomain } from "../src/jobs/classifier.js";

describe("classifier", () => {
  describe("classifyApp", () => {
    it("classifies Xcode as development", () => {
      const result = classifyApp("com.apple.dt.Xcode");
      assert.equal(result.category, "development");
      assert.equal(result.subcategory, "ide");
    });

    it("classifies Chrome as browser", () => {
      const result = classifyApp("com.google.Chrome");
      assert.equal(result.category, "browser");
      assert.equal(result.subcategory, "web");
    });

    it("classifies VSCode as development", () => {
      const result = classifyApp("com.microsoft.VSCode");
      assert.equal(result.category, "development");
      assert.equal(result.subcategory, "editor");
    });

    it("classifies JetBrains IDEs as development", () => {
      assert.equal(classifyApp("com.jetbrains.intellij").category, "development");
      assert.equal(classifyApp("com.jetbrains.WebStorm").category, "development");
    });

    it("classifies Slack as communication", () => {
      const result = classifyApp("com.slack.Slack");
      assert.equal(result.category, "communication");
      assert.equal(result.subcategory, "chat");
    });

    it("classifies Spotify as entertainment", () => {
      const result = classifyApp("com.spotify.client");
      assert.equal(result.category, "entertainment");
      assert.equal(result.subcategory, "music");
    });

    it("classifies Figma as design", () => {
      const result = classifyApp("com.figma.Desktop");
      assert.equal(result.category, "design");
      assert.equal(result.subcategory, "ui");
    });

    it("classifies Notion as productivity", () => {
      const result = classifyApp("com.notion.Notion");
      assert.equal(result.category, "productivity");
      assert.equal(result.subcategory, "notes");
    });

    it("classifies WeChat as communication", () => {
      const result = classifyApp("com.tencent.xinWeChat");
      assert.equal(result.category, "communication");
      assert.equal(result.subcategory, "chat");
    });

    it("returns uncategorized for unknown app", () => {
      const result = classifyApp("com.unknown.random.app");
      assert.equal(result.category, "uncategorized");
      assert.equal(result.subcategory, undefined);
    });
  });

  describe("classifyDomain", () => {
    it("classifies github.com as development", () => {
      const result = classifyDomain("github.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "development");
      assert.equal(result!.subcategory, "code_hosting");
    });

    it("classifies youtube.com as entertainment", () => {
      const result = classifyDomain("youtube.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "entertainment");
      assert.equal(result!.subcategory, "video");
    });

    it("classifies slack.com as communication", () => {
      const result = classifyDomain("slack.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "communication");
      assert.equal(result!.subcategory, "chat");
    });

    it("classifies notion.so as productivity", () => {
      const result = classifyDomain("notion.so");
      assert.notEqual(result, null);
      assert.equal(result!.category, "productivity");
      assert.equal(result!.subcategory, "notes");
    });

    it("classifies chatgpt.com as ai", () => {
      const result = classifyDomain("chatgpt.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "ai");
      assert.equal(result!.subcategory, "assistant");
    });

    it("classifies linkedin.com as social", () => {
      const result = classifyDomain("linkedin.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "social");
      assert.equal(result!.subcategory, "professional");
    });

    it("returns null for blocked domains", () => {
      const result = classifyDomain("malware.example.com");
      assert.equal(result, null);
    });

    it("returns uncategorized for unknown domain", () => {
      const result = classifyDomain("random-site-xyz.com");
      assert.notEqual(result, null);
      assert.equal(result!.category, "uncategorized");
    });
  });
});
