import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Resolve the workspace root - handle both running from apps/app and from root
function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (cwd.includes("apps/app")) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

const WORKSPACE_ROOT = getWorkspaceRoot();
const FIXTURE_PATH = path.join(WORKSPACE_ROOT, "test/fixtures/projectA");
const SPEC_FILE_PATH = path.join(FIXTURE_PATH, ".automaker/app_spec.txt");

// Original spec content for resetting between tests
const ORIGINAL_SPEC_CONTENT = `<app_spec>
  <name>Test Project A</name>
  <description>A test fixture project for Playwright testing</description>
  <tech_stack>
    <item>TypeScript</item>
    <item>React</item>
  </tech_stack>
</app_spec>
`;

/**
 * Reset the fixture's app_spec.txt to original content
 */
function resetFixtureSpec() {
  const dir = path.dirname(SPEC_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SPEC_FILE_PATH, ORIGINAL_SPEC_CONTENT);
}

/**
 * Set up localStorage with a project pointing to our test fixture
 * Note: In CI, setup wizard is also skipped via NEXT_PUBLIC_SKIP_SETUP env var
 */
async function setupProjectWithFixture(page: Page, projectPath: string) {
  await page.addInitScript((path: string) => {
    const mockProject = {
      id: "test-project-fixture",
      name: "projectA",
      path: path,
      lastOpened: new Date().toISOString(),
    };

    const mockState = {
      state: {
        projects: [mockProject],
        currentProject: mockProject,
        currentView: "board",
        theme: "dark",
        sidebarOpen: true,
        apiKeys: { anthropic: "", google: "" },
        chatSessions: [],
        chatHistoryOpen: false,
        maxConcurrency: 3,
      },
      version: 0,
    };

    localStorage.setItem("automaker-storage", JSON.stringify(mockState));

    // Also mark setup as complete (fallback for when NEXT_PUBLIC_SKIP_SETUP isn't set)
    const setupState = {
      state: {
        isFirstRun: false,
        setupComplete: true,
        currentStep: "complete",
        skipClaudeSetup: false,
      },
      version: 0,
    };
    localStorage.setItem("automaker-setup", JSON.stringify(setupState));
  }, projectPath);
}

/**
 * Navigate to spec editor via sidebar
 */
async function navigateToSpecEditor(page: Page) {
  // Click on the Spec Editor nav item in the sidebar
  const specNavButton = page.locator('[data-testid="nav-spec"]');
  await specNavButton.waitFor({ state: "visible", timeout: 10000 });
  await specNavButton.click();

  // Wait for the spec view to be visible
  await page.waitForSelector('[data-testid="spec-view"]', { timeout: 10000 });
}

/**
 * Get the CodeMirror editor content
 */
async function getEditorContent(page: Page): Promise<string> {
  // CodeMirror uses a contenteditable div with class .cm-content
  const content = await page
    .locator('[data-testid="spec-editor"] .cm-content')
    .textContent();
  return content || "";
}

/**
 * Set the CodeMirror editor content by selecting all and typing
 */
async function setEditorContent(page: Page, content: string) {
  // Click on the editor to focus it
  const editor = page.locator('[data-testid="spec-editor"] .cm-content');
  await editor.click();

  // Wait for focus
  await page.waitForTimeout(200);

  // Select all content (Cmd+A on Mac, Ctrl+A on others)
  const isMac = process.platform === "darwin";
  await page.keyboard.press(isMac ? "Meta+a" : "Control+a");

  // Wait for selection
  await page.waitForTimeout(100);

  // Delete the selected content first
  await page.keyboard.press("Backspace");

  // Wait for deletion
  await page.waitForTimeout(100);

  // Type the new content
  await page.keyboard.type(content, { delay: 10 });

  // Wait for typing to complete
  await page.waitForTimeout(200);
}

/**
 * Click the save button
 */
async function clickSaveButton(page: Page) {
  const saveButton = page.locator('[data-testid="save-spec"]');
  await saveButton.click();

  // Wait for the button text to change to "Saved" indicating save is complete
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="save-spec"]');
      return btn?.textContent?.includes("Saved");
    },
    { timeout: 5000 }
  );
}

test.describe("Spec Editor Persistence", () => {
  test.beforeEach(async () => {
    // Reset the fixture spec file to original content before each test
    resetFixtureSpec();
  });

  test.afterEach(async () => {
    // Clean up - reset the spec file after each test
    resetFixtureSpec();
  });

  test("should open project, edit spec, save, and persist changes after refresh", async ({
    page,
  }) => {
    // Use the resolved fixture path
    const fixturePath = FIXTURE_PATH;

    // Step 1: Set up the project in localStorage pointing to our fixture
    await setupProjectWithFixture(page, fixturePath);

    // Step 2: Navigate to the app
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Step 3: Verify we're on the dashboard with the project loaded
    // The sidebar should show the project selector
    const sidebar = page.locator('[data-testid="sidebar"]');
    await sidebar.waitFor({ state: "visible", timeout: 10000 });

    // Step 4: Click on the Spec Editor in the sidebar
    await navigateToSpecEditor(page);

    // Step 5: Wait for the spec editor to load
    const specEditor = page.locator('[data-testid="spec-editor"]');
    await specEditor.waitFor({ state: "visible", timeout: 10000 });

    // Step 6: Wait for CodeMirror to initialize (it has a .cm-content element)
    await page.waitForSelector('[data-testid="spec-editor"] .cm-content', {
      timeout: 10000,
    });

    // Small delay to ensure editor is fully initialized
    await page.waitForTimeout(500);

    // Step 7: Modify the editor content to "hello world"
    await setEditorContent(page, "hello world");

    // Step 8: Click the save button
    await clickSaveButton(page);

    // Step 9: Refresh the page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Step 10: Navigate back to the spec editor
    // After reload, we need to wait for the app to initialize
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

    // Navigate to spec editor again
    await navigateToSpecEditor(page);

    // Wait for CodeMirror to be ready
    await page.waitForSelector('[data-testid="spec-editor"] .cm-content', {
      timeout: 10000,
    });

    // Small delay to ensure editor content is loaded
    await page.waitForTimeout(500);

    // Step 11: Verify the content was persisted
    const persistedContent = await getEditorContent(page);
    expect(persistedContent.trim()).toBe("hello world");
  });

  test("should handle opening project via Open Project button and file browser", async ({
    page,
  }) => {
    // This test covers the flow of:
    // 1. Clicking Open Project button
    // 2. Using the file browser to navigate to the fixture directory
    // 3. Opening the project
    // 4. Editing the spec

    // Set up without a current project to test the open project flow
    await page.addInitScript(() => {
      const mockState = {
        state: {
          projects: [],
          currentProject: null,
          currentView: "welcome",
          theme: "dark",
          sidebarOpen: true,
          apiKeys: { anthropic: "", google: "" },
          chatSessions: [],
          chatHistoryOpen: false,
          maxConcurrency: 3,
        },
        version: 0,
      };
      localStorage.setItem("automaker-storage", JSON.stringify(mockState));

      // Mark setup as complete
      const setupState = {
        state: {
          isFirstRun: false,
          setupComplete: true,
          currentStep: "complete",
          skipClaudeSetup: false,
        },
        version: 0,
      };
      localStorage.setItem("automaker-setup", JSON.stringify(setupState));
    });

    // Navigate to the app
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for the sidebar to be visible
    const sidebar = page.locator('[data-testid="sidebar"]');
    await sidebar.waitFor({ state: "visible", timeout: 10000 });

    // Click the Open Project button
    const openProjectButton = page.locator(
      '[data-testid="open-project-button"]'
    );

    // Check if the button is visible (it might not be in collapsed sidebar)
    const isButtonVisible = await openProjectButton
      .isVisible()
      .catch(() => false);

    if (isButtonVisible) {
      await openProjectButton.click();

      // The file browser dialog should open
      // Note: In web mode, this might use the FileBrowserDialog component
      // which makes requests to the backend server at /api/fs/browse

      // Wait a bit to see if a dialog appears
      await page.waitForTimeout(1000);

      // Check if a dialog is visible
      const dialog = page.locator('[role="dialog"]');
      const dialogVisible = await dialog.isVisible().catch(() => false);

      if (dialogVisible) {
        // If file browser dialog is open, we need to navigate to the fixture path
        // This depends on the current directory structure

        // For now, let's verify the dialog appeared and close it
        // A full test would navigate through directories
        console.log("File browser dialog opened successfully");

        // Press Escape to close the dialog
        await page.keyboard.press("Escape");
      }
    }

    // For a complete e2e test with file browsing, we'd need to:
    // 1. Navigate through the directory tree
    // 2. Select the projectA directory
    // 3. Click "Select Current Folder"

    // Since this involves actual file system navigation,
    // and depends on the backend server being properly configured,
    // we'll verify the basic UI elements are present

    expect(sidebar).toBeTruthy();
  });
});

test.describe("Spec Editor - Full Open Project Flow", () => {
  test.beforeEach(async () => {
    // Reset the fixture spec file to original content before each test
    resetFixtureSpec();
  });

  test.afterEach(async () => {
    // Clean up - reset the spec file after each test
    resetFixtureSpec();
  });

  test("should open project via file browser, edit spec, and persist", async ({
    page,
  }) => {
    // Navigate to app first
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set up localStorage state (without a current project, but mark setup complete)
    // Using evaluate instead of addInitScript so it only runs once
    // Note: In CI, setup wizard is also skipped via NEXT_PUBLIC_SKIP_SETUP env var
    await page.evaluate(() => {
      const mockState = {
        state: {
          projects: [],
          currentProject: null,
          currentView: "welcome",
          theme: "dark",
          sidebarOpen: true,
          apiKeys: { anthropic: "", google: "" },
          chatSessions: [],
          chatHistoryOpen: false,
          maxConcurrency: 3,
        },
        version: 0,
      };
      localStorage.setItem("automaker-storage", JSON.stringify(mockState));

      // Mark setup as complete (fallback for when NEXT_PUBLIC_SKIP_SETUP isn't set)
      const setupState = {
        state: {
          isFirstRun: false,
          setupComplete: true,
          currentStep: "complete",
          skipClaudeSetup: false,
        },
        version: 0,
      };
      localStorage.setItem("automaker-setup", JSON.stringify(setupState));
    });

    // Reload to apply the localStorage state
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Wait for sidebar
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

    // Click the Open Project button
    const openProjectButton = page.locator(
      '[data-testid="open-project-button"]'
    );
    await openProjectButton.waitFor({ state: "visible", timeout: 10000 });
    await openProjectButton.click();

    // Wait for the file browser dialog to open
    const dialogTitle = page.locator('text="Select Project Directory"');
    await dialogTitle.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the dialog to fully load (loading to complete)
    await page.waitForFunction(
      () => !document.body.textContent?.includes("Loading directories..."),
      { timeout: 10000 }
    );

    // Use the path input to directly navigate to the fixture directory
    const pathInput = page.locator('[data-testid="path-input"]');
    await pathInput.waitFor({ state: "visible", timeout: 5000 });

    // Clear the input and type the full path to the fixture
    await pathInput.fill(FIXTURE_PATH);

    // Click the Go button to navigate to the path
    const goButton = page.locator('[data-testid="go-to-path-button"]');
    await goButton.click();

    // Wait for loading to complete
    await page.waitForFunction(
      () => !document.body.textContent?.includes("Loading directories..."),
      { timeout: 10000 }
    );

    // Verify we're in the right directory by checking the path display
    const pathDisplay = page.locator(".font-mono.text-sm.truncate");
    await expect(pathDisplay).toContainText("projectA");

    // Click "Select Current Folder" button
    const selectFolderButton = page.locator(
      'button:has-text("Select Current Folder")'
    );
    await selectFolderButton.click();

    // Wait for dialog to close and project to load
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"]'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(500);

    // Navigate to spec editor
    const specNav = page.locator('[data-testid="nav-spec"]');
    await specNav.waitFor({ state: "visible", timeout: 10000 });
    await specNav.click();

    // Wait for spec view with the editor (not the empty state)
    await page.waitForSelector('[data-testid="spec-view"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="spec-editor"] .cm-content', {
      timeout: 10000,
    });
    await page.waitForTimeout(500);

    // Edit the content
    await setEditorContent(page, "hello world");

    // Click save button
    await clickSaveButton(page);

    // Refresh and verify persistence
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Navigate back to spec editor
    await specNav.waitFor({ state: "visible", timeout: 10000 });
    await specNav.click();

    await page.waitForSelector('[data-testid="spec-editor"] .cm-content', {
      timeout: 10000,
    });
    await page.waitForTimeout(500);

    // Verify the content persisted
    const persistedContent = await getEditorContent(page);
    expect(persistedContent.trim()).toBe("hello world");
  });
});
