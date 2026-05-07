import os
import ssl
import sys


def _patch_ssl():
    original_create_default_context = ssl.create_default_context

    def insecure_default_context(*args, **kwargs):
        context = original_create_default_context(*args, **kwargs)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context

    ssl._create_default_https_context = ssl._create_unverified_context
    ssl.create_default_context = insecure_default_context


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: hermesRunner.py <hermes_repo> -- <hermes args...>')

    try:
        divider_index = sys.argv.index('--')
    except ValueError as error:
        raise SystemExit('Usage: hermesRunner.py <hermes_repo> -- <hermes args...>') from error

    hermes_repo = os.path.abspath(sys.argv[1])
    hermes_args = sys.argv[divider_index + 1:]

    if not os.path.isdir(hermes_repo):
        raise SystemExit(f'Hermes repo not found: {hermes_repo}')

    sys.path.insert(0, hermes_repo)
    os.chdir(hermes_repo)
    _patch_ssl()

    from hermes_cli.main import main as hermes_main

    sys.argv = ['hermes', *hermes_args]
    hermes_main()


if __name__ == '__main__':
    main()
