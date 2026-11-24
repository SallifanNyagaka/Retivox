#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>
#include <winreg.h>

#include <algorithm>
#include <string>

#include "flutter_window.h"
#include "utils.h"
#include "app_links/app_links_plugin_c_api.h"

namespace {
void RegisterRetivoxProtocol(const std::wstring& executable_path) {
  HKEY protocol_key = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\retivox", 0,
                      nullptr, 0, KEY_WRITE, nullptr, &protocol_key,
                      nullptr) != ERROR_SUCCESS) {
    return;
  }
  const wchar_t description[] = L"URL:Retivox Protocol";
  RegSetValueExW(protocol_key, nullptr, 0, REG_SZ,
                 reinterpret_cast<const BYTE*>(description),
                 sizeof(description));
  RegSetValueExW(protocol_key, L"URL Protocol", 0, REG_SZ,
                 reinterpret_cast<const BYTE*>(L""), sizeof(wchar_t));
  RegCloseKey(protocol_key);

  HKEY command_key = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Classes\\retivox\\shell\\open\\command",
                      0, nullptr, 0, KEY_WRITE, nullptr, &command_key,
                      nullptr) != ERROR_SUCCESS) {
    return;
  }
  const std::wstring command = L"\"" + executable_path + L"\" \"%1\"";
  RegSetValueExW(command_key, nullptr, 0, REG_SZ,
                 reinterpret_cast<const BYTE*>(command.c_str()),
                 static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(command_key);
}
}  // namespace

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Forward protocol callbacks to an already-running app instance.
  if (SendAppLinkToInstance()) {
    return EXIT_SUCCESS;
  }
  // Flutter resolves its bundled `data` directory relative to the current
  // working directory. Desktop shortcuts and file associations may launch us
  // with another directory, so anchor startup to the installed executable.
  std::wstring executable_path(32768, L'\0');
  const DWORD executable_path_length = GetModuleFileNameW(
      nullptr, executable_path.data(),
      static_cast<DWORD>(executable_path.size()));
  if (executable_path_length == 0 ||
      executable_path_length >= executable_path.size()) {
    return EXIT_FAILURE;
  }
  executable_path.resize(executable_path_length);
  RegisterRetivoxProtocol(executable_path);
  const size_t directory_separator = executable_path.find_last_of(L"\\/");
  if (directory_separator == std::wstring::npos) {
    return EXIT_FAILURE;
  }
  executable_path.resize(directory_separator);
  if (!SetCurrentDirectoryW(executable_path.c_str())) {
    return EXIT_FAILURE;
  }

  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();
  const bool background_sync =
      std::find(command_line_arguments.begin(), command_line_arguments.end(),
                "--background-sync") != command_line_arguments.end();

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project, !background_sync);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(1280, 720);
  if (!window.Create(L"Retivox", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
