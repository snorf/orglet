import { describe, expect, it } from "vitest";
import { contentTypeFor, fileExtensionOf, fileTypeFor } from "./filetypes.js";

describe("file types (D-09, D-06)", () => {
  it("maps documented extensions to their FileType token", () => {
    const expected: Record<string, string> = {
      pdf: "PDF", docx: "WORD_X", doc: "WORD", xlsx: "EXCEL_X", xls: "EXCEL", pptx: "POWER_POINT_X", ppt: "POWER_POINT",
      png: "PNG", jpg: "JPG", gif: "GIF", txt: "TEXT", csv: "CSV", zip: "ZIP", xml: "XML", html: "HTML", htm: "HTML",
      svg: "SVG", mp3: "MP3", mp4: "MP4", mov: "MOV", avi: "AVI", wav: "WAV", wma: "WMA", wmv: "WMV", mpeg: "MPEG",
    };
    for (const [ext, type] of Object.entries(expected)) expect(fileTypeFor(ext), ext).toBe(type);
  });
  it("lookup ignores extension case", () => {
    expect(fileTypeFor("PDF")).toBe("PDF");
  });
  it("unsourced and unknown extensions are UNKNOWN with application/octet-stream", () => {
    for (const ext of ["jpeg", "json", "exe", "", null]) {
      expect(fileTypeFor(ext)).toBe("UNKNOWN");
      expect(contentTypeFor(ext)).toBe("application/octet-stream");
    }
  });
  it("content types come from the same table", () => {
    expect(contentTypeFor("pdf")).toBe("application/pdf");
    expect(contentTypeFor("png")).toBe("image/png");
    expect(contentTypeFor("svg")).toBe("image/svg+xml");
    expect(contentTypeFor("html")).toBe("text/html");
    expect(contentTypeFor("txt")).toBe("text/plain");
  });
  it("fileExtensionOf takes the lowercased text after the last dot of the basename", () => {
    expect(fileExtensionOf("C:\\docs\\Report.Final.PDF")).toBe("pdf");
    expect(fileExtensionOf("/tmp/a.tar.gz")).toBe("gz");
    expect(fileExtensionOf("README")).toBeNull();
    expect(fileExtensionOf(".bashrc")).toBeNull();
    expect(fileExtensionOf("name.")).toBeNull();
    expect(fileExtensionOf("x." + "a".repeat(50))).toHaveLength(40);
  });
});
