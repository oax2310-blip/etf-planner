package io.github.oax2310blip.etfplanner;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

// OS 저장 선택기 동안만 원문 바이트를 앱 전용 캐시에 보관한다. 웹 기록·키·JSON에는 접근하지 않는다.
public final class PendingExport {
    private final File file;
    private PendingExport(File file) { this.file = file; }

    public static PendingExport create(File cache, byte[] bytes) throws IOException {
        File folder = new File(cache, "planner-exports");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("백업 임시 폴더를 만들 수 없습니다.");
        File file = File.createTempFile("export-", ".bin", folder);
        try {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
                output.getFD().sync();
            }
            return new PendingExport(file);
        } catch (IOException error) { file.delete(); throw error; }
    }

    // Bundle에는 작은 파일 식별자만 둔다. 캐시가 지워진 경우 open()이 실패해 UI가 재시도를 안내한다.
    public static PendingExport restore(File cache, String id) {
        if (id == null || !id.matches("export-[0-9]+\\.bin")) return null;
        return new PendingExport(new File(new File(cache, "planner-exports"), id));
    }
    public String id() { return file.getName(); }
    public InputStream open() throws IOException { return new FileInputStream(file); }
    public void discard() { file.delete(); }
}
