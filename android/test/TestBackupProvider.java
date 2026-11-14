package io.github.oax2310blip.etfplanner;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.nio.charset.StandardCharsets;

// 테스트 APK에만 넣는 가상 JSON 공급자. 실제 파일·기록·토큰을 읽지 않는다.
public final class TestBackupProvider extends ContentProvider {
    static final byte[] BYTES = "{\"plans\":[],\"note\":\"가상 복원\"}\n".getBytes(StandardCharsets.UTF_8);
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/json"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[]{"test-backup.json", BYTES.length}); return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            new Thread(() -> { try (java.io.OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) { out.write(BYTES); } catch (Exception ignored) {} }).start();
            return pipe[0];
        } catch (Exception error) { throw new java.io.FileNotFoundException(); }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
