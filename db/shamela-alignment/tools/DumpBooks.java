import java.nio.file.*;
import java.io.*;
import java.util.*;
import org.apache.lucene.store.*;
import org.apache.lucene.index.*;
import org.apache.lucene.document.*;

/** Read-only dump of page bodies for several Shamela books in one pass over the page index.
 *  Usage: DumpBooks <indexDir> <outDir> <bookId> [<bookId>...]  -> <outDir>/<bookId>.tsv (page_id \t body) */
public class DumpBooks {
  public static void main(String[] a) throws Exception {
    Path indexDir = Paths.get(a[0]), outDir = Paths.get(a[1]);
    Files.createDirectories(outDir);
    Map<String, Writer> out = new HashMap<>();
    for (int i = 2; i < a.length; i++)
      out.put(a[i], new OutputStreamWriter(new FileOutputStream(outDir.resolve(a[i] + ".tsv").toFile()), "UTF-8"));
    Map<String, Integer> counts = new TreeMap<>();
    try (Directory dir = FSDirectory.open(indexDir);
         IndexReader reader = DirectoryReader.open(dir)) {
      StoredFields sf = reader.storedFields();
      int max = reader.maxDoc();
      for (int i = 0; i < max; i++) {
        Document d = sf.document(i, Set.of("id"));
        String id = d.get("id");
        if (id == null) continue;
        int dash = id.indexOf('-');
        if (dash < 0) continue;
        Writer w = out.get(id.substring(0, dash));
        if (w == null) continue;
        Document full = sf.document(i);
        String body = full.get("body");
        if (body == null) body = "";
        body = body.replace("\t", " ").replace("\r", " ").replace("\n", " \\n ");
        String foot = full.get("foot");
        if (foot == null) foot = "";
        foot = foot.replace("\t", " ").replace("\r", " ").replace("\n", " \\n ");
        w.write(id.substring(dash + 1) + "\t" + body + "\t" + foot + "\n");
        counts.merge(id.substring(0, dash), 1, Integer::sum);
      }
    } finally {
      for (Writer w : out.values()) w.close();
    }
    System.out.println("pages written: " + counts);
  }
}
