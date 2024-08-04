import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * @typedef {{
*   name: string
*   version: string
*   dependencies?: { [dependenciesPackageName: string]: string }
*   peerDependencies?: { [peerDependenciesPackageName: string]: string }
* }} Package
*/

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const packages = fs
    .readdirSync(path.resolve(__dirname, '../packages'))
    .filter(p => {
        const pkgRoot = path.resolve(__dirname, '../packages', p)
        if (fs.statSync(pkgRoot).isDirectory()) {
            const pkg = JSON.parse(
                fs.readFileSync(path.resolve(pkgRoot, 'package.json'), 'utf-8'),
            )
            return !pkg.private
        }
    })

function updateVersions(version) {
    // 1. update root package.json
    updatePackage(path.resolve(__dirname, '..'), version)
    // 2. update all packages
    packages.forEach(p =>
        updatePackage(getPkgRoot(p), version),
    )
}

/**
 * 
 * @param {string} pkg 
 */
function getPkgRoot(pkg) {
    return path.resolve(__dirname, '../packages/' + pkg)
}

/**
 * @param {string} pkgRoot
 * @param {string} version
 */
function updatePackage(pkgRoot, version) {
    const pkgPath = path.resolve(pkgRoot, 'package.json')
    /** @type {Package} */
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    pkg.version = version
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

async function main() {
    const version = process.argv[2]
    if (!version) {
        console.error('Please provide a version, e.g. `npm run release 1.0.0`')
        process.exit(1)
    }

    updateVersions(version)
    console.log('Releasing ' + version)
}

await main()
