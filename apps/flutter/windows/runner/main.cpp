#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <algorithm>
#include <string>

#include "flutter_window.h"
#include "utils.h"

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
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
