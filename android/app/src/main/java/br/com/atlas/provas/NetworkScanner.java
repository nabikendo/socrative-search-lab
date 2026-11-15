package br.com.atlas.provas;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.HttpURLConnection;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Procura o computador do professor na rede local: testa /api/health nas portas 80 e 8080 de cada endereço da sub-rede. */
final class NetworkScanner {
    private NetworkScanner() {}

    static List<String> find() {
        List<String> prefixes = prefixes();
        List<String> found = Collections.synchronizedList(new ArrayList<String>());
        ExecutorService pool = Executors.newFixedThreadPool(96);
        List<Future<?>> tasks = new ArrayList<>();
        for (String prefix : prefixes) {
            for (int host = 1; host <= 254; host++) {
                for (final int port : new int[] {80, 8080}) {
                    final String address = prefix + host;
                    tasks.add(pool.submit(new Runnable() {
                        @Override public void run() {
                            if (isAtlas(address, port)) found.add(port == 80 ? address : address + ":" + port);
                        }
                    }));
                }
            }
        }
        for (Future<?> task : tasks) {
            try { task.get(); } catch (Exception ignored) { /* endereço sem resposta */ }
        }
        pool.shutdownNow();
        List<String> result = new ArrayList<>(found);
        Collections.sort(result);
        return result;
    }

    private static List<String> prefixes() {
        List<String> prefixes = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress interfaceAddress : network.getInterfaceAddresses()) {
                    InetAddress address = interfaceAddress.getAddress();
                    if (!(address instanceof Inet4Address) || !address.isSiteLocalAddress()) continue;
                    String ip = address.getHostAddress();
                    String prefix = ip.substring(0, ip.lastIndexOf('.') + 1);
                    if (!prefixes.contains(prefix)) prefixes.add(prefix);
                }
            }
        } catch (Exception ignored) { /* sem rede */ }
        return prefixes;
    }

    private static boolean isAtlas(String host, int port) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://" + host + ":" + port + "/api/health").openConnection();
            connection.setConnectTimeout(500);
            connection.setReadTimeout(800);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return false;
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            char[] buffer = new char[200];
            int read = reader.read(buffer);
            reader.close();
            return read > 0 && new String(buffer, 0, read).replace(" ", "").contains("\"ok\":true");
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
