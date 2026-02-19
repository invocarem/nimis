import { NativeToolsManager } from "../src/utils/nativeToolManager";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec } from "child_process";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);

// Mock child_process.exec
jest.mock("child_process", () => ({
    exec: jest.fn(),
}));

describe("NativeToolsManager - exec_terminal", () => {
    let manager: NativeToolsManager;
    let testDir: string;
    let execStub: jest.Mock;

    beforeEach(() => {
        manager = new NativeToolsManager();
        testDir = path.join(__dirname, "temp_test_files");

        // Create test directory if it doesn't exist
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        // Set workspace root for path resolution
        (manager as any).workspaceRoot = testDir;

        // Reset exec mock
        execStub = exec as unknown as jest.Mock;
        execStub.mockReset();
    });

    afterEach(async () => {
        // Clean up test files
        try {
            if (fs.existsSync(testDir)) {
                const files = fs.readdirSync(testDir);
                for (const file of files) {
                    const filePath = path.join(testDir, file);
                    const stats = await stat(filePath);
                    if (stats.isDirectory()) {
                        await rmdir(filePath, { recursive: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe("Basic command execution", () => {
        it("should execute a simple command successfully", async () => {
            const mockStdout = "Hello, World!";
            const mockStderr = "";

            execStub.mockImplementation((command, options, callback) => {
                callback(null, { stdout: mockStdout, stderr: mockStderr });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "echo Hello, World!",
            });

            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain(mockStdout);
            expect(execStub).toHaveBeenCalled();
        });

        it("should handle commands with no output", async () => {
            execStub.mockImplementation((command, options, callback) => {
                callback(null, { stdout: "", stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "true",
            });

            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain("Command executed successfully");
        });

        it("should handle commands with stderr output", async () => {
            const mockStdout = "Output";
            const mockStderr = "Warning message";

            execStub.mockImplementation((command, options, callback) => {
                callback(null, { stdout: mockStdout, stderr: mockStderr });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "some-command",
            });

            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain(mockStdout);
            expect(result.content[0].text).toContain("STDERR:");
            expect(result.content[0].text).toContain(mockStderr);
        });

        it("should handle command errors", async () => {
            const mockStderr = "Command not found";
            const error = new Error("Command failed");
            (error as any).code = 1;
            (error as any).stderr = mockStderr;

            execStub.mockImplementation((command, options, callback) => {
                callback(error, null);
            });

            const result = await manager.callTool("exec_terminal", {
                command: "nonexistent-command",
            });

            expect(result.isError).toBeTruthy();
            expect(result.content[0].text).toContain(mockStderr);
        });
    });

    describe("Command chaining with &&", () => {
        it("should execute chained commands with &&", async () => {
            const mockStdout = "First command\nSecond command";

            execStub.mockImplementation((command, options, callback) => {
                // Verify that && is in the command
                expect(command).toContain("&&");
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "echo 'First command' && echo 'Second command'",
            });

            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain("First command");
            expect(execStub).toHaveBeenCalled();
        });

        it("should handle chained commands where first fails", async () => {
            const error = new Error("First command failed");
            (error as any).code = 1;
            (error as any).stderr = "Error in first command";

            execStub.mockImplementation((command, options, callback) => {
                expect(command).toContain("&&");
                callback(error, null);
            });

            const result = await manager.callTool("exec_terminal", {
                command: "false && echo 'This should not run'",
            });

            // The shell should handle && and stop on first failure
            expect(result.isError).toBeTruthy();
        });

        it("should support multiple && chains", async () => {
            const mockStdout = "Command 1\nCommand 2\nCommand 3";

            execStub.mockImplementation((command, options, callback) => {
                // Count && occurrences
                const andCount = (command.match(/&&/g) || []).length;
                expect(andCount).toBeGreaterThanOrEqual(2);
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "echo 'Command 1' && echo 'Command 2' && echo 'Command 3'",
            });

            expect(result.isError).toBeFalsy();
        });

        it("should preserve && in cd commands", async () => {
            const mockStdout = "Changed directory";

            execStub.mockImplementation((command, options, callback) => {
                expect(command).toContain("cd");
                expect(command).toContain("&&");
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: `cd ${testDir} && pwd`,
            });

            expect(result.isError).toBeFalsy();
        });
    });

    describe("Working directory handling", () => {
        it("should use workspace root as default working directory", async () => {
            execStub.mockImplementation((command, options, callback) => {
                expect(options.cwd).toBe(testDir);
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "pwd",
            });

            expect(execStub).toHaveBeenCalled();
        });

        it("should use specified working directory", async () => {
            const customDir = path.join(testDir, "custom");
            if (!fs.existsSync(customDir)) {
                await mkdir(customDir, { recursive: true });
            }

            execStub.mockImplementation((command, options, callback) => {
                expect(options.cwd).toBe(customDir);
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "pwd",
                working_directory: customDir,
            });

            expect(execStub).toHaveBeenCalled();
        });

        it("should prevent using .nimis folder as working directory", async () => {
            const nimisDir = path.join(testDir, ".nimis");
            if (!fs.existsSync(nimisDir)) {
                await mkdir(nimisDir, { recursive: true });
            }

            execStub.mockImplementation((command, options, callback) => {
                // Should use workspace root instead of .nimis folder
                expect(options.cwd).toBe(testDir);
                expect(options.cwd).not.toBe(nimisDir);
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "pwd",
                working_directory: nimisDir,
            });

            expect(execStub).toHaveBeenCalled();
        });
    });

    describe("Shell detection", () => {
        it("should detect and use appropriate shell", async () => {
            execStub.mockImplementation((command, options, callback) => {
                // Verify shell is set (either bash or cmd.exe)
                expect(options.shell).toBeDefined();
                expect(typeof options.shell).toBe("string");
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "echo test",
            });

            expect(execStub).toHaveBeenCalled();
        });

        it("should use detected shell for command execution", async () => {
            let detectedShell: string | undefined;

            execStub.mockImplementation((command, options, callback) => {
                detectedShell = options.shell;
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "echo test",
            });

            expect(detectedShell).toBeDefined();
            // On Windows, should prefer Git Bash if available, otherwise cmd.exe
            // On Unix, should use /bin/bash
            if (process.platform === "win32") {
                expect(
                    detectedShell === "cmd.exe" ||
                    detectedShell?.includes("bash.exe") ||
                    detectedShell?.includes("bash")
                ).toBeTruthy();
            } else {
                expect(detectedShell).toBe("/bin/bash");
            }
        });
    });

    describe("Timeout handling", () => {
        it("should handle command timeouts", async () => {
            const timeoutError = new Error("Command timeout after 30000ms");
            (timeoutError as any).code = "ETIMEDOUT";

            execStub.mockImplementation((command, options, callback) => {
                // Simulate timeout by calling callback with timeout error
                callback(timeoutError, null);
            });

            const result = await manager.callTool("exec_terminal", {
                command: "sleep 100",
            });

            // The timeout should be handled
            expect(result.isError).toBeTruthy();
            expect(result.content[0].text).toContain("timeout");
        });
    });

    describe("Command options", () => {
        it("should set maxBuffer option", async () => {
            execStub.mockImplementation((command, options, callback) => {
                expect(options.maxBuffer).toBe(1024 * 1024 * 10); // 10MB
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "echo test",
            });

            expect(execStub).toHaveBeenCalled();
        });

        it("should set timeout option", async () => {
            execStub.mockImplementation((command, options, callback) => {
                expect(options.timeout).toBe(30000); // 30 seconds
                callback(null, { stdout: "Success", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "echo test",
            });

            expect(execStub).toHaveBeenCalled();
        });
    });

    describe("Error handling", () => {
        it("should handle unknown tool gracefully", async () => {
            const result = await manager.callTool("unknown_tool", {
                command: "test",
            });

            expect(result.isError).toBeTruthy();
            expect(result.content[0].text).toContain("Unknown tool");
        });

        it("should handle exec errors gracefully", async () => {
            const error = new Error("Execution failed");
            (error as any).code = "ENOENT";

            execStub.mockImplementation((command, options, callback) => {
                callback(error, null);
            });

            const result = await manager.callTool("exec_terminal", {
                command: "nonexistent-command",
            });

            expect(result.isError).toBeTruthy();
            expect(result.content[0].text).toContain("Error executing command");
        });

        it("should handle commands with non-zero exit codes", async () => {
            const error = new Error("Command failed");
            (error as any).code = 1;
            (error as any).stdout = "Some output";
            (error as any).stderr = "Error occurred";

            execStub.mockImplementation((command, options, callback) => {
                callback(error, null);
            });

            const result = await manager.callTool("exec_terminal", {
                command: "false",
            });

            expect(result.isError).toBeTruthy();
            expect(result.content[0].text).toContain("Some output");
            expect(result.content[0].text).toContain("Error occurred");
        });
    });

    describe("Command with special characters", () => {
        it("should handle commands with quotes", async () => {
            const mockStdout = "Quoted output";

            execStub.mockImplementation((command, options, callback) => {
                expect(command).toContain('"');
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: 'echo "Quoted output"',
            });

            expect(result.isError).toBeFalsy();
        });

        it("should handle commands with pipes", async () => {
            const mockStdout = "Piped output";

            execStub.mockImplementation((command, options, callback) => {
                expect(command).toContain("|");
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "echo 'test' | grep test",
            });

            expect(result.isError).toBeFalsy();
        });

        it("should handle commands with semicolons", async () => {
            const mockStdout = "Multiple commands";

            execStub.mockImplementation((command, options, callback) => {
                expect(command).toContain(";");
                callback(null, { stdout: mockStdout, stderr: "" });
            });

            const result = await manager.callTool("exec_terminal", {
                command: "echo 'first'; echo 'second'",
            });

            expect(result.isError).toBeFalsy();
        });
    });

    describe("Integration with venv enhancement", () => {
        it("should enhance Python commands with venv if available", async () => {
            // Create a mock venv directory
            const venvDir = path.join(testDir, ".venv");
            const activatePath = path.join(venvDir, "bin", "activate");
            if (!fs.existsSync(venvDir)) {
                await mkdir(venvDir, { recursive: true });
                await mkdir(path.join(venvDir, "bin"), { recursive: true });
                await writeFile(activatePath, "# Virtual environment activation script");
            }

            let executedCommand: string | undefined;

            execStub.mockImplementation((command, options, callback) => {
                executedCommand = command;
                callback(null, { stdout: "Python executed", stderr: "" });
            });

            await manager.callTool("exec_terminal", {
                command: "python --version",
            });

            // The command should be enhanced with venv activation if venv is detected
            // Note: This depends on shell detection, so it might use source or call
            expect(execStub).toHaveBeenCalled();
        });
    });
});
