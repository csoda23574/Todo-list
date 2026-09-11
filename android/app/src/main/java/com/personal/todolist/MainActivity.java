package com.personal.todolist;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HoyoLabPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(240, 242, 247)));
        if (getBridge() != null) getBridge().getWebView().setBackgroundColor(Color.rgb(240, 242, 247));
    }
}
