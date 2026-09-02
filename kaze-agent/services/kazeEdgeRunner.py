import os
import sys


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: kazeEdgeRunner.py <kazeEdge_repo> -- <kazeEdge args...>')

    try:
        divider_index = sys.argv.index('--')
    except ValueError as error:
        raise SystemExit('Usage: kazeEdgeRunner.py <kazeEdge_repo> -- <kazeEdge args...>') from error

    kazeEdge_repo = os.path.abspath(sys.argv[1])
    kazeEdge_args = sys.argv[divider_index + 1:]

    if not os.path.isdir(kazeEdge_repo):
        raise SystemExit(f'KazeEdge repo not found: {kazeEdge_repo}')

    sys.path.insert(0, kazeEdge_repo)
    os.chdir(kazeEdge_repo)

    from kazeEdge_cli.main import main as kazeEdge_main

    sys.argv = ['kazeEdge', *kazeEdge_args]
    kazeEdge_main()


if __name__ == '__main__':
    main()
