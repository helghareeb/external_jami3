import java.nio.file.*;
import java.io.*;
import java.util.*;
import org.apache.lucene.store.*;
import org.apache.lucene.index.*;
import org.apache.lucene.document.*;

/** Read-only dump of a Shamela Lucene store for the given books: docs whose "id" is "<book>-<n>".
 *  Usage: DumpTitles <storeDir> <outDir> <bookId>...  -> <outDir>/<bookId>.tsv (n \t field=value ...) */
public class DumpTitles {
  public static void main(String[] a) throws Exception {
    Path outDir = Paths.get(a[1]);
    Files.createDirectories(outDir);
    Map<String, Writer> out = new HashMap<>();
    for (int i = 2; i < a.length; i++)
      out.put(a[i], new OutputStreamWriter(new FileOutputStream(outDir.resolve(a[i] + ".tsv").toFile()), "UTF-8"));
    try (Directory dir = FSDirectory.open(Paths.get(a[0])); IndexReader reader = DirectoryReader.open(dir)) {
      StoredFields sf = reader.storedFields();
      boolean shown = false;
      for (int i = 0; i < reader.maxDoc(); i++) {
        Document d = sf.document(i);
        if (!shown) { System.out.println("fields: " + d.getFields().stream().map(f -> f.name()).toList()); shown = true; }
        String id = d.get("id");
        if (id == null) continue;
        int dash = id.indexOf('-');
        if (dash < 0) continue;
        Writer w = out.get(id.substring(0, dash));
        if (w == null) continue;
        StringBuilder sb = new StringBuilder(id.substring(dash + 1));
        for (IndexableField f : d.getFields())
          if (!f.name().equals("id")) sb.append('\t').append(f.name()).append('=').append(String.valueOf(f.stringValue()).replace("\t", " ").replace("\n", " "));
        w.write(sb.append('\n').toString());
      }
    } finally { for (Writer w : out.values()) w.close(); }
  }
}
