package br.com.atlas.provas;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;
import java.util.Locale;

/** Tela inicial: acha o computador do professor e abre a prova (aluno) ou o painel (professor). */
public class MainActivity extends Activity {
    private static final String PREFS = "atlas";
    private static final String KEY_HOST = "host";

    private EditText addressField;
    private TextView status;
    private Button scanButton;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable shape(int color, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(10));
        if (stroke != 0) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private Button button(String text, boolean primary) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setTextColor(primary ? Color.WHITE : Color.parseColor("#1D1D1F"));
        button.setBackground(primary ? shape(Color.parseColor("#007AFF"), 0) : shape(Color.parseColor("#E9E9EE"), 0));
        button.setStateListAnimator(null);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        params.topMargin = dp(10);
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int size, String color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.parseColor(color));
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#F5F5F7"));
        scroll.setFillViewport(true);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(24), dp(48), dp(24), dp(24));
        scroll.addView(column);

        column.addView(text("Atlas", 34, "#1D1D1F", true));
        TextView lead = text("Provas na rede da sala, sem Internet. Conecte o celular ao Wi‑Fi do professor.", 16, "#6E6E73", false);
        lead.setPadding(0, dp(6), 0, dp(24));
        column.addView(lead);

        TextView label = text("Endereço do professor", 13, "#6E6E73", true);
        column.addView(label);
        addressField = new EditText(this);
        addressField.setHint("ex.: 192.168.0.25");
        addressField.setSingleLine(true);
        addressField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressField.setTextColor(Color.parseColor("#1D1D1F"));
        addressField.setHintTextColor(Color.parseColor("#8E8E93"));
        addressField.setBackground(shape(Color.WHITE, Color.parseColor("#D2D2D7")));
        addressField.setPadding(dp(14), dp(12), dp(14), dp(12));
        addressField.setText(getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HOST, ""));
        LinearLayout.LayoutParams fieldParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fieldParams.topMargin = dp(6);
        column.addView(addressField, fieldParams);

        scanButton = button("Procurar na rede", false);
        scanButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { scan(); }
        });
        column.addView(scanButton);

        status = text("", 14, "#6E6E73", false);
        status.setPadding(0, dp(10), 0, dp(10));
        column.addView(status);

        Button student = button("Entrar na prova (aluno)", true);
        student.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { open("/prova"); }
        });
        column.addView(student);

        Button test = button("Testar a conexão", false);
        test.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { open("/teste"); }
        });
        column.addView(test);

        Button teacher = button("Painel do professor", false);
        teacher.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { open("/professor"); }
        });
        column.addView(teacher);

        TextView note = text("O Atlas continua rodando no computador do professor. Este aplicativo só abre a prova e o painel dele.", 13, "#8E8E93", false);
        note.setPadding(0, dp(24), 0, 0);
        column.addView(note);

        setContentView(scroll);
    }

    /** Aceita "192.168.0.25", "192.168.0.25:8080" ou "http://…/prova"; devolve só host[:porta] ou null. */
    static String normalize(String raw) {
        if (raw == null) return null;
        String value = raw.trim().toLowerCase(Locale.ROOT).replaceFirst("^https?://", "");
        int slash = value.indexOf('/');
        if (slash >= 0) value = value.substring(0, slash);
        return value.matches("[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?") ? value : null;
    }

    private void open(String path) {
        String host = normalize(addressField.getText().toString());
        if (host == null) {
            status.setText("Digite o endereço mostrado na tela do professor, ou toque em Procurar na rede.");
            return;
        }
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_HOST, host).apply();
        Intent intent = new Intent(this, WebActivity.class);
        intent.putExtra(WebActivity.EXTRA_URL, "http://" + host + path);
        startActivity(intent);
    }

    private void scan() {
        scanButton.setEnabled(false);
        status.setText("Procurando o Atlas na rede…");
        new Thread(new Runnable() {
            @Override public void run() {
                final List<String> found = NetworkScanner.find();
                runOnUiThread(new Runnable() {
                    @Override public void run() { onFound(found); }
                });
            }
        }).start();
    }

    private void onFound(final List<String> found) {
        scanButton.setEnabled(true);
        if (found.isEmpty()) {
            status.setText("Não encontrei o Atlas. Confira se o celular está no mesmo Wi‑Fi do professor e se o Atlas está aberto, ou digite o endereço.");
        } else if (found.size() == 1) {
            addressField.setText(found.get(0));
            status.setText("Atlas encontrado: " + found.get(0));
        } else {
            status.setText("Encontrei mais de um Atlas. Escolha o do seu professor.");
            new AlertDialog.Builder(this)
                .setTitle("Escolha o professor")
                .setItems(found.toArray(new String[0]), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        addressField.setText(found.get(which));
                        status.setText("Atlas selecionado: " + found.get(which));
                    }
                })
                .show();
        }
    }
}
