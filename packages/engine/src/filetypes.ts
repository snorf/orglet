/**
 * ContentVersion.FileType is derived from the file extension, and the same small table supplies the download
 * Content-Type, so a token or media type exists only when a public source names it (D-09); everything else is
 * UNKNOWN / application/octet-stream.
 */
// Media types are IANA registrations, independent of the Salesforce FileType token.
const FILE_TYPES: ReadonlyMap<string, { fileType: string; contentType: string }> = new Map([
  // Metadata API FileTypeDispositionAssignmentBean enumeration (sf-skills FileUploadAndDownloadSecuritySettings); apex-recipes FilesRecipes.cls:191; Salesforce developer blog 2020 (.docx -> WORD_X)
  ["pdf", { fileType: "PDF", contentType: "application/pdf" }],
  ["docx", { fileType: "WORD_X", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
  ["doc", { fileType: "WORD", contentType: "application/msword" }],
  ["xlsx", { fileType: "EXCEL_X", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
  ["xls", { fileType: "EXCEL", contentType: "application/vnd.ms-excel" }],
  ["pptx", { fileType: "POWER_POINT_X", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }],
  ["ppt", { fileType: "POWER_POINT", contentType: "application/vnd.ms-powerpoint" }],
  ["xml", { fileType: "XML", contentType: "application/xml" }],
  ["html", { fileType: "HTML", contentType: "text/html" }],
  ["htm", { fileType: "HTML", contentType: "text/html" }],
  ["svg", { fileType: "SVG", contentType: "image/svg+xml" }],
  ["mp3", { fileType: "MP3", contentType: "audio/mpeg" }],
  ["mp4", { fileType: "MP4", contentType: "video/mp4" }],
  ["mov", { fileType: "MOV", contentType: "video/quicktime" }],
  ["avi", { fileType: "AVI", contentType: "video/x-msvideo" }],
  ["wav", { fileType: "WAV", contentType: "audio/wav" }],
  ["wma", { fileType: "WMA", contentType: "audio/x-ms-wma" }],
  ["wmv", { fileType: "WMV", contentType: "video/x-ms-wmv" }],
  ["mpeg", { fileType: "MPEG", contentType: "video/mpeg" }],
  // trailheadapps/apex-recipes FilesRecipes.cls:188 (FileType IN ('JPG','GIF','PNG','JPEG')); .jpeg is left out: no source says which token it gets
  ["png", { fileType: "PNG", contentType: "image/png" }],
  ["jpg", { fileType: "JPG", contentType: "image/jpeg" }],
  ["gif", { fileType: "GIF", contentType: "image/gif" }],
  // SimplySfdc "Salesforce: Content Architecture" (2014, dated)
  ["txt", { fileType: "TEXT", contentType: "text/plain" }],
  ["csv", { fileType: "CSV", contentType: "text/csv" }],
  ["zip", { fileType: "ZIP", contentType: "application/zip" }],
]);

export function fileTypeFor(extension: string | null): string {
  return (extension && FILE_TYPES.get(extension.toLowerCase())?.fileType) || "UNKNOWN";
}

export function contentTypeFor(extension: string | null): string {
  return (extension && FILE_TYPES.get(extension.toLowerCase())?.contentType) || "application/octet-stream";
}

/** Lowercased text after the last dot of the PathOnClient basename; null without one. Truncated to the field's 40 characters. */
export function fileExtensionOf(pathOnClient: string): string | null {
  const base = pathOnClient.slice(Math.max(pathOnClient.lastIndexOf("/"), pathOnClient.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase().slice(0, 40);
}
