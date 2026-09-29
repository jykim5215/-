package android.content;

import java.util.ArrayList;
import java.util.List;

public class IntentFilter {
    private final List<String> actions = new ArrayList<>();
    public final void addAction(String action) { actions.add(action); }
    public final boolean hasAction(String action) { return actions.contains(action); }
    public final List<String> actions() { return actions; }
}
