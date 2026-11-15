package br.com.atlas.provas;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Mostra a prova (ou o painel) do Atlas dentro do aplicativo, só no endereço do professor. */
public class WebActivity extends Activity {
    static final String EXTRA_URL = "url";
    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_STORAGE = 2;

    private WebView web;
    private String startUrl;
    private String authority;
    private ValueCallback<Uri[]> chooser;
    private String[] pendingDownload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // a tela não apaga durante a prova
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        startUrl = getIntent().getStringExtra(EXTRA_URL);
        if (startUrl == null) { finish(); return; }
        authority = Uri.parse(startUrl).getAuthority();

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // as respostas ficam guardadas no aparelho se o Wi‑Fi cair
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (sameServer(request.getUrl())) return false;
                Toast.makeText(WebActivity.this, "Só é possível abrir páginas do Atlas.", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                    + "<body style='font-family:sans-serif;padding:32px;color:#1D1D1F;background:#F5F5F7'>"
                    + "<h2>Sem conexão com o professor</h2>"
                    + "<p>Confira se o celular está no Wi‑Fi da sala e se o Atlas está aberto no computador.</p>"
                    + "<p><a href='" + startUrl + "' style='color:#007AFF;font-size:18px'>Tentar de novo</a></p></body></html>";
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE);
                } catch (Exception error) {
                    chooser = null;
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long length) {
                download(new String[] {url, userAgent, contentDisposition, mimeType});
            }
        });

        web.loadUrl(startUrl);
    }

    private boolean sameServer(Uri uri) {
        String scheme = uri.getScheme();
        return ("http".equals(scheme) || "https".equals(scheme)) && authority != null && authority.equalsIgnoreCase(uri.getAuthority());
    }

    private void download(String[] args) {
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = args;
            requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_STORAGE);
            return;
        }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(args[0]));
            String cookie = CookieManager.getInstance().getCookie(args[0]);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.addRequestHeader("User-Agent", args[1]);
            String name = URLUtil.guessFileName(args[0], args[2], args[3]);
            request.setMimeType(args[3]);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "Baixando " + name + " na pasta Downloads", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "Não foi possível baixar o arquivo.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_STORAGE || pendingDownload == null) return;
        String[] args = pendingDownload;
        pendingDownload = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) download(args);
        else Toast.makeText(this, "Sem permissão para salvar o arquivo.", Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            chooser = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        new AlertDialog.Builder(this)
            .setMessage("Sair desta tela? Suas respostas já enviadas ficam salvas.")
            .setNegativeButton("Ficar", null)
            .setPositiveButton("Sair", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) { finish(); }
            })
            .show();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
